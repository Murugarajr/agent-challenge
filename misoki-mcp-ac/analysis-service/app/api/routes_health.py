from __future__ import annotations

from fastapi import APIRouter

from app.core.ohm_loader import ensure_ohm_mcp_on_path
from app.settings import get_settings


router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    settings = get_settings()
    ohm_src = ensure_ohm_mcp_on_path(settings.ohm_mcp_src_path)
    return {
        "status": "ok",
        "service": "misoki-analysis-service",
        "ohm_mcp_src": str(ohm_src),
    }

