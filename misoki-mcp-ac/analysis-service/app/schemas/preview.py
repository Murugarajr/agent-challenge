from __future__ import annotations

from pydantic import BaseModel


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

