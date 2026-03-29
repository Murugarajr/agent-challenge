from __future__ import annotations

from pydantic import BaseModel, Field


DEFAULT_CATEGORIES = [
    "architecture",
    "dead_code",
    "duplication",
    "performance",
    "type_hints",
]


class RepoAnalyzeRequest(BaseModel):
    github_url: str
    branch: str | None = None
    max_files: int = Field(default=40, ge=1, le=200)
    include_categories: list[str] = Field(default_factory=lambda: list(DEFAULT_CATEGORIES))


class AnalysisIssue(BaseModel):
    file: str
    category: str
    severity: str
    title: str
    details: str
    line: int | None = None
    fixable: bool = False
    fix_id: str
    source_type: str


class SeveritySummary(BaseModel):
    critical: int = 0
    warning: int = 0
    info: int = 0


class RepoAnalyzeResponse(BaseModel):
    repo: str
    branch: str
    commit: str
    files_scanned: int
    skipped_files: int
    categories: dict[str, int]
    summary: SeveritySummary
    issues: list[AnalysisIssue]

