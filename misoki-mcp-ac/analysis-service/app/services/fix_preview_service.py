from __future__ import annotations

from dataclasses import dataclass
from difflib import unified_diff
from functools import lru_cache

from app.core.github_fetcher import GitHubRepoFetcher
from app.schemas.preview import PreviewFixRequest, PreviewFixResponse
from app.settings import Settings, get_settings


@dataclass(frozen=True)
class ParsedFixId:
    category: str
    file_path: str
    line: int
    source_type: str


class FixPreviewService:
    def __init__(self, settings: Settings):
        self.fetcher = GitHubRepoFetcher(
            api_base=settings.github_api_base,
            timeout_seconds=settings.request_timeout_seconds,
            max_file_bytes=settings.max_file_bytes,
            verify_ssl=settings.verify_ssl,
            max_concurrent_file_fetches=settings.max_concurrent_file_fetches,
        )

    async def preview_fix(self, request: PreviewFixRequest) -> PreviewFixResponse:
        parsed_fix = self._parse_fix_id(request.fix_id)
        repo_file = await self.fetcher.fetch_file(
            github_url=request.github_url,
            file_path=parsed_fix.file_path,
            branch=request.branch,
        )

        if parsed_fix.source_type != "unused_import":
            return PreviewFixResponse(
                file=parsed_fix.file_path,
                line=parsed_fix.line,
                source_type=parsed_fix.source_type,
                risk="medium",
                supported=False,
                message=f"Preview is not implemented yet for '{parsed_fix.source_type}'.",
                original=repo_file.content,
                modified=repo_file.content,
                diff="",
            )

        modified = self._remove_line(repo_file.content, parsed_fix.line)
        diff = "".join(
            unified_diff(
                repo_file.content.splitlines(keepends=True),
                modified.splitlines(keepends=True),
                fromfile=f"a/{parsed_fix.file_path}",
                tofile=f"b/{parsed_fix.file_path}",
            )
        )

        return PreviewFixResponse(
            file=parsed_fix.file_path,
            line=parsed_fix.line,
            source_type=parsed_fix.source_type,
            risk="low",
            supported=True,
            message="Preview generated for unused import removal.",
            original=repo_file.content,
            modified=modified,
            diff=diff,
        )

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
        )

    def _remove_line(self, content: str, line_number: int) -> str:
        lines = content.splitlines(keepends=True)
        if line_number < 1 or line_number > len(lines):
            raise ValueError("fix_id points to a line outside the file")

        target_line = lines[line_number - 1].strip()
        if not (target_line.startswith("import ") or target_line.startswith("from ")):
            raise ValueError("previewed line is not an import statement")

        del lines[line_number - 1]
        return "".join(lines)


@lru_cache(maxsize=1)
def get_fix_preview_service() -> FixPreviewService:
    return FixPreviewService(get_settings())

