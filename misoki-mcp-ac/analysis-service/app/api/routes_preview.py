from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.preview import (
    BatchPreviewFixRequest,
    BatchPreviewResponse,
    PreviewFixRequest,
    PreviewFixResponse,
)
from app.services.fix_preview_service import get_fix_preview_service


router = APIRouter(prefix="/preview", tags=["preview"])


@router.post("/fix", response_model=PreviewFixResponse)
async def preview_fix(request: PreviewFixRequest) -> PreviewFixResponse:
    try:
        service = get_fix_preview_service()
        return await service.preview_fix(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/batch", response_model=BatchPreviewResponse)
async def preview_batch(request: BatchPreviewFixRequest) -> BatchPreviewResponse:
    """Preview multiple fixes in one request.

    Individual preview failures are returned as BatchPreviewItem.error rather
    than aborting the whole request, so the caller always gets a result per
    fix_id.
    """
    try:
        service = get_fix_preview_service()
        return await service.batch_preview(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

