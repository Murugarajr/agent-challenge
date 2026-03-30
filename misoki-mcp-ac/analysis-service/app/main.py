from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_apply import router as apply_router
from app.api.routes_analyze import router as analyze_router
from app.api.routes_health import router as health_router
from app.api.routes_preview import router as preview_router


app = FastAPI(
    title="Misoki Analysis Service",
    version="0.1.0",
    description="Repo analysis service powered by ohm-mcp analyzers.",
)

# Add CORS middleware to allow the web frontend to communicate with this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in prod if necessary
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(health_router)
app.include_router(analyze_router)
app.include_router(preview_router)
app.include_router(apply_router)
