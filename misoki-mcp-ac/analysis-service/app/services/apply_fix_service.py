from __future__ import annotations

import asyncio
from dataclasses import dataclass
from difflib import unified_diff
from functools import lru_cache
import re

from app.core.github_fetcher import GitHubRepoFetcher, RepoFile
from app.schemas.apply import (
    AppliedFilePatch,
    ApplyFixRequest,
    ApplyFixResponse,
    AppliedFixResult,
    SkippedFixResult,
)
from app.settings import Settings, get_settings


@dataclass(frozen=True)
class ParsedFixId:
    category: str
    file_path: str
    line: int
    source_type: str
    fix_id: str


class ApplyFixService:
    def __init__(self, settings: Settings):
        self.fetcher = GitHubRepoFetcher(
            api_base=settings.github_api_base,
            timeout_seconds=settings.request_timeout_seconds,
            max_file_bytes=settings.max_file_bytes,
            verify_ssl=settings.verify_ssl,
            max_concurrent_file_fetches=settings.max_concurrent_file_fetches,
            github_token=settings.github_token,
        )

    async def apply_fixes(self, request: ApplyFixRequest) -> ApplyFixResponse:
        parsed_fix_ids = [self._parse_fix_id(fix_id) for fix_id in request.fix_ids]
        grouped: dict[str, list[ParsedFixId]] = {}
        for parsed in parsed_fix_ids:
            grouped.setdefault(parsed.file_path, []).append(parsed)

        file_contents = await self._fetch_files_concurrent(
            github_url=request.github_url,
            file_paths=list(grouped.keys()),
            branch=request.branch,
        )

        applied: list[AppliedFixResult] = []
        skipped: list[SkippedFixResult] = []
        files: list[AppliedFilePatch] = []

        for file_path, file_fix_ids in grouped.items():
            repo_file = file_contents.get(file_path)
            if repo_file is None:
                for parsed in file_fix_ids:
                    skipped.append(
                        SkippedFixResult(
                            fix_id=parsed.fix_id,
                            file=parsed.file_path,
                            line=parsed.line,
                            source_type=parsed.source_type,
                            reason="Could not fetch file from GitHub.",
                        )
                    )
                continue

            original = repo_file.content
            modified = original
            applied_fix_ids: list[str] = []
            seen_lines: set[int] = set()

            for parsed in sorted(file_fix_ids, key=lambda item: item.line, reverse=True):
                if parsed.source_type not in {"unused_import", "unused_variable"}:
                    skipped.append(
                        SkippedFixResult(
                            fix_id=parsed.fix_id,
                            file=parsed.file_path,
                            line=parsed.line,
                            source_type=parsed.source_type,
                            reason=f"Safe apply is not implemented yet for '{parsed.source_type}'.",
                        )
                    )
                    continue

                if parsed.line in seen_lines:
                    skipped.append(
                        SkippedFixResult(
                            fix_id=parsed.fix_id,
                            file=parsed.file_path,
                            line=parsed.line,
                            source_type=parsed.source_type,
                            reason="Another fix already modified this line in the same apply request.",
                        )
                    )
                    continue

                try:
                    if parsed.source_type == "unused_import":
                        modified = self._remove_import_line(modified, parsed.line)
                        message = "Applied unused import removal."
                    else:
                        modified = self._rewrite_unused_variable(modified, parsed.line)
                        message = "Applied unused variable rewrite."
                    applied_fix_ids.append(parsed.fix_id)
                    seen_lines.add(parsed.line)
                    applied.append(
                        AppliedFixResult(
                            fix_id=parsed.fix_id,
                            file=parsed.file_path,
                            line=parsed.line,
                            source_type=parsed.source_type,
                            applied=True,
                            risk="low",
                            message=message,
                        )
                    )
                except ValueError as exc:
                    skipped.append(
                        SkippedFixResult(
                            fix_id=parsed.fix_id,
                            file=parsed.file_path,
                            line=parsed.line,
                            source_type=parsed.source_type,
                            reason=str(exc),
                        )
                    )

            if modified != original:
                diff = "".join(
                    unified_diff(
                        original.splitlines(keepends=True),
                        modified.splitlines(keepends=True),
                        fromfile=f"a/{file_path}",
                        tofile=f"b/{file_path}",
                    )
                )
                files.append(
                    AppliedFilePatch(
                        file=file_path,
                        applied_fix_ids=applied_fix_ids,
                        original=original,
                        modified=modified,
                        diff=diff,
                    )
                )

        combined_diff = "\n".join(file.diff.rstrip("\n") for file in files if file.diff).strip()
        return ApplyFixResponse(
            repo=request.github_url,
            branch=request.branch or "default",
            applied_count=len(applied),
            skipped_count=len(skipped),
            applied_fix_ids=[result.fix_id for result in applied],
            applied=applied,
            skipped=skipped,
            files=files,
            combined_diff=f"{combined_diff}\n" if combined_diff else "",
        )

    async def _fetch_files_concurrent(
        self,
        github_url: str,
        file_paths: list[str],
        branch: str | None,
    ) -> dict[str, RepoFile]:
        """Fetch all needed files concurrently instead of one-by-one."""
        async def _fetch_one(path: str) -> tuple[str, RepoFile | None]:
            try:
                repo_file = await self.fetcher.fetch_file(
                    github_url=github_url,
                    file_path=path,
                    branch=branch,
                )
                return (path, repo_file)
            except Exception:
                return (path, None)

        results = await asyncio.gather(*[_fetch_one(p) for p in file_paths])
        return {path: rf for path, rf in results if rf is not None}

    def _parse_fix_id(self, fix_id: str) -> ParsedFixId:
        parts = fix_id.split(":")
        if len(parts) < 4:
            raise ValueError("fix_id is invalid")

        category = parts[0]
        source_type = parts[-1]
        line_str = parts[-2]
        file_path = ":".join(parts[1:-2])

        try:
            line = int(line_str)
        except ValueError as exc:
            raise ValueError("fix_id line component is invalid") from exc

        return ParsedFixId(
            category=category,
            file_path=file_path,
            line=line,
            source_type=source_type,
            fix_id=fix_id,
        )

    def _remove_import_line(self, content: str, line_number: int) -> str:
        lines = content.splitlines(keepends=True)
        if line_number < 1 or line_number > len(lines):
            raise ValueError("fix_id points to a line outside the file")

        target_line = lines[line_number - 1].strip()
        if not (target_line.startswith("import ") or target_line.startswith("from ")):
            raise ValueError("target line is not an import statement")

        del lines[line_number - 1]
        return "".join(lines)

    def _rewrite_unused_variable(self, content: str, line_number: int) -> str:
        lines = content.splitlines(keepends=True)
        if line_number < 1 or line_number > len(lines):
            raise ValueError("fix_id points to a line outside the file")

        line = lines[line_number - 1]
        match = re.match(
            r"^(?P<indent>\s*)(?P<target>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<expr>.+?)(?P<newline>\r?\n?)$",
            line,
        )
        if not match:
            raise ValueError("target line is not a simple assignment suitable for safe rewrite")

        lines[line_number - 1] = (
            f"{match.group('indent')}_ = {match.group('expr')}{match.group('newline')}"
        )
        return "".join(lines)


@lru_cache(maxsize=1)
def get_apply_fix_service() -> ApplyFixService:
    return ApplyFixService(get_settings())
