from __future__ import annotations

from pydantic import BaseModel, Field


class PreviewFixRequest(BaseModel):
    github_url: str
    fix_id: str
    branch: str | None = None


class PreviewFixResponse(BaseModel):
    file: str
    line: int | None = None
    source_type: str
    risk: str
    supported: bool
    message: str
    original: str
    modified: str
    diff: str


class BatchPreviewFixRequest(BaseModel):
    github_url: str
    fix_ids: list[str] = Field(min_length=1)
    branch: str | None = None


class BatchPreviewItem(BaseModel):
    fix_id: str
    file: str
    line: int | None = None
    source_type: str
    risk: str
    supported: bool
    message: str
    diff: str
    error: str | None = None  # set if preview failed for this fix_id


class BatchPreviewResponse(BaseModel):
    repo: str
    branch: str | None
    previews: list[BatchPreviewItem]

