from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.file_filter import PythonFileFilter
from app.core.github_fetcher import GitHubRepoFetcher, RepoFile
from app.core.issue_mapper import IssueMapper
from app.core.ohm_loader import ensure_ohm_mcp_on_path
from app.schemas.analyze import AnalysisIssue, RepoAnalyzeRequest, RepoAnalyzeResponse, SeveritySummary
from app.settings import Settings, get_settings


class RepoAnalyzerService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.fetcher = GitHubRepoFetcher(
            api_base=settings.github_api_base,
            timeout_seconds=settings.request_timeout_seconds,
            max_file_bytes=settings.max_file_bytes,
            verify_ssl=settings.verify_ssl,
            max_concurrent_file_fetches=settings.max_concurrent_file_fetches,
            github_token=settings.github_token,
        )
        self.file_filter = PythonFileFilter(max_file_bytes=settings.max_file_bytes)
        self.issue_mapper = IssueMapper()

        ensure_ohm_mcp_on_path(settings.ohm_mcp_src_path)

        from ohm_mcp.refactoring.analysis import CodeAnalyzer
        from ohm_mcp.refactoring.architecture_analyzer import ArchitectureAnalyzer
        from ohm_mcp.refactoring.dead_code_detector import DeadCodeDetector
        from ohm_mcp.refactoring.duplication_detector import DuplicationDetector
        from ohm_mcp.refactoring.performance_analyzer import PerformanceAnalyzer
        from ohm_mcp.refactoring.type_hint_analyzer import TypeHintAnalyzer

        self.code_analyzer = CodeAnalyzer()
        self.architecture_analyzer = ArchitectureAnalyzer()
        self.dead_code_detector = DeadCodeDetector()
        self.duplication_detector = DuplicationDetector()
        self.performance_analyzer = PerformanceAnalyzer()
        self.type_hint_analyzer = TypeHintAnalyzer()

    async def analyze_repo(self, request: RepoAnalyzeRequest) -> RepoAnalyzeResponse:
        snapshot = await self.fetcher.fetch_repo_snapshot(
            github_url=request.github_url,
            branch=request.branch,
            max_files=min(request.max_files, self.settings.max_repo_files),
        )
        selection = self.file_filter.select_files(
            files=snapshot.files,
            max_files=min(request.max_files, self.settings.max_repo_files),
        )
        categories = set(request.include_categories)
        issues: list[AnalysisIssue] = []

        for repo_file in selection.selected_files:
            if "architecture" in categories:
                analysis = self.architecture_analyzer.analyze_file(repo_file.content, repo_file.path)
                issues.extend(
                    self.issue_mapper.map_many(
                        analysis.get("detailed_issues", []),
                        "architecture",
                        repo_file.path,
                        source_code=repo_file.content,
                    )
                )

            if "dead_code" in categories:
                analysis = self.dead_code_detector.detect_all(repo_file.content, repo_file.path)
                issues.extend(
                    self.issue_mapper.map_many(
                        analysis.get("detailed_issues", []),
                        "dead_code",
                        repo_file.path,
                        source_code=repo_file.content,
                    )
                )

            if "performance" in categories:
                analysis = self.performance_analyzer.analyze_performance(repo_file.content, repo_file.path)
                issues.extend(
                    self.issue_mapper.map_many(
                        analysis.get("detailed_issues", []),
                        "performance",
                        repo_file.path,
                        source_code=repo_file.content,
                    )
                )

            if "type_hints" in categories:
                issues.extend(self._analyze_type_hints(repo_file))

            if "code_quality" in categories:
                analysis = self.code_analyzer.analyze(repo_file.content, repo_file.path)
                issues.extend(
                    self.issue_mapper.map_many(
                        analysis.get("detailed_issues", []),
                        "code_quality",
                        repo_file.path,
                        source_code=repo_file.content,
                    )
                )

        if "duplication" in categories and len(selection.selected_files) >= 2:
            issues.extend(self._analyze_duplication(selection.selected_files))

        issues.sort(key=lambda issue: (issue.file, issue.line or 0, issue.category, issue.title))
        category_summary = self._summarize_categories(issues)
        severity_summary = self._summarize_severity(issues)

        return RepoAnalyzeResponse(
            repo=snapshot.github_url,
            branch=snapshot.branch,
            commit=snapshot.commit_sha,
            files_scanned=len(selection.selected_files),
            skipped_files=selection.skipped_files,
            categories=category_summary,
            summary=severity_summary,
            issues=issues,
        )

    def _analyze_duplication(self, files: list[RepoFile]) -> list[AnalysisIssue]:
        with TemporaryDirectory(prefix="misoki-analysis-") as temp_dir:
            project_root = Path(temp_dir)
            file_paths: list[str] = []

            for repo_file in files:
                target = project_root / repo_file.path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(repo_file.content, encoding="utf-8")
                file_paths.append(str(target))

            duplicates = self.duplication_detector.detect_duplicates(
                project_root=str(project_root),
                file_paths=file_paths,
                include_near_duplicates=False,  # O(N^2) sliding window comparison causes hangs
                include_functions=True,
            )

        return [
            self.issue_mapper.map_duplication_issue(duplicate)
            for duplicate in duplicates.get("detailed_duplicates", [])
        ]

    def _analyze_type_hints(self, repo_file: RepoFile) -> list[AnalysisIssue]:
        coverage = self.type_hint_analyzer.analyze_coverage_only(repo_file.content, repo_file.path)
        missing_hints = coverage.get("missing_hints", [])
        coverage_percent = float(coverage.get("coverage_percent", 0.0))

        return [
            self.issue_mapper.map_type_hint_issue(
                file_path=repo_file.path,
                function_name=missing_hint["name"],
                line=missing_hint["line"],
                coverage_percent=coverage_percent,
            )
            for missing_hint in missing_hints
        ]

    def _summarize_categories(self, issues: list[AnalysisIssue]) -> dict[str, int]:
        summary: dict[str, int] = {}
        for issue in issues:
            summary[issue.category] = summary.get(issue.category, 0) + 1
        return dict(sorted(summary.items()))

    def _summarize_severity(self, issues: list[AnalysisIssue]) -> SeveritySummary:
        summary = SeveritySummary()
        for issue in issues:
            if issue.severity == "critical":
                summary.critical += 1
            elif issue.severity == "warning":
                summary.warning += 1
            else:
                summary.info += 1
        return summary


@lru_cache(maxsize=1)
def get_repo_analyzer_service() -> RepoAnalyzerService:
    return RepoAnalyzerService(get_settings())
