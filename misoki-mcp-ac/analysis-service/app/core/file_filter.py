from __future__ import annotations

from dataclasses import dataclass

from app.core.github_fetcher import RepoFile
from app.core.path_priority import python_file_priority


@dataclass(frozen=True)
class FileSelection:
    selected_files: list[RepoFile]
    skipped_files: int
    total_python_files: int


class PythonFileFilter:
    def __init__(self, max_file_bytes: int):
        self.max_file_bytes = max_file_bytes

    def select_files(self, files: list[RepoFile], max_files: int) -> FileSelection:
        python_files = [
            repo_file
            for repo_file in files
            if repo_file.path.endswith(".py") and repo_file.size <= self.max_file_bytes
        ]
        python_files.sort(key=lambda item: python_file_priority(item.path))
        selected = python_files[:max_files]
        skipped = max(0, len(python_files) - len(selected))
        return FileSelection(
            selected_files=selected,
            skipped_files=skipped,
            total_python_files=len(python_files),
        )
