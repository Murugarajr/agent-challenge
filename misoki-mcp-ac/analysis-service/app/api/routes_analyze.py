from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.analyze import RepoAnalyzeRequest, RepoAnalyzeResponse
from app.services.repo_analyzer import get_repo_analyzer_service


router = APIRouter(prefix="/analyze", tags=["analysis"])


@router.post("/repo", response_model=RepoAnalyzeResponse)
async def analyze_repo(request: RepoAnalyzeRequest) -> RepoAnalyzeResponse:
    try:
        service = get_repo_analyzer_service()
        return await service.analyze_repo(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
