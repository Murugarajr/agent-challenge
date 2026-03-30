from __future__ import annotations

from pydantic import BaseModel, Field


class ApplyFixRequest(BaseModel):
    github_url: str
    branch: str | None = None
    fix_ids: list[str] = Field(min_length=1)


class AppliedFixResult(BaseModel):
    fix_id: str
    file: str
    line: int
    source_type: str
    applied: bool
    risk: str
    message: str


class SkippedFixResult(BaseModel):
    fix_id: str
    file: str | None = None
    line: int | None = None
    source_type: str | None = None
    reason: str


class AppliedFilePatch(BaseModel):
    file: str
    applied_fix_ids: list[str]
    original: str
    modified: str
    diff: str


class ApplyFixResponse(BaseModel):
    repo: str
    branch: str
    applied_count: int
    skipped_count: int
    applied_fix_ids: list[str]
    applied: list[AppliedFixResult]
    skipped: list[SkippedFixResult]
    files: list[AppliedFilePatch]
    combined_diff: str
