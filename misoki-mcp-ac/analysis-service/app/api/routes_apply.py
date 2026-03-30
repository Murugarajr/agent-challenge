from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.apply import ApplyFixRequest, ApplyFixResponse
from app.services.apply_fix_service import get_apply_fix_service


router = APIRouter(prefix="/apply", tags=["apply"])


@router.post("/fixes", response_model=ApplyFixResponse)
async def apply_fixes(request: ApplyFixRequest) -> ApplyFixResponse:
    try:
        service = get_apply_fix_service()
        return await service.apply_fixes(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
