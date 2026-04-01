"""Integration tests for the FastAPI endpoints.

These tests use httpx.AsyncClient against the real FastAPI app.
Tests that hit the GitHub API are marked with @pytest.mark.integration
and skipped in CI unless MISOKI_RUN_INTEGRATION=1 is set.

The /health endpoint is always tested.
"""
from __future__ import annotations

import os

import pytest
import httpx

from app.main import app


SAMPLE_REPO = "https://github.com/pallets/click"
RUN_INTEGRATION = os.getenv("MISOKI_RUN_INTEGRATION", "0") == "1"
skip_integration = pytest.mark.skipif(
    not RUN_INTEGRATION,
    reason="Set MISOKI_RUN_INTEGRATION=1 to run integration tests that hit GitHub",
)


@pytest.fixture
def client():
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ── Health endpoint ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_returns_ok(client):
    async with client as c:
        r = await c.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "misoki-analysis-service"


# ── Analyze endpoint (integration) ────────────────────────────────────

@skip_integration
@pytest.mark.asyncio
async def test_analyze_repo_returns_structured_json(client):
    async with client as c:
        r = await c.post("/analyze/repo", json={
            "github_url": SAMPLE_REPO,
            "max_files": 3,
            "include_categories": ["dead_code", "architecture"],
        }, timeout=60)
    assert r.status_code == 200
    body = r.json()
    assert body["repo"] == SAMPLE_REPO
    assert isinstance(body["commit"], str) and len(body["commit"]) >= 7
    assert isinstance(body["files_scanned"], int)
    assert "summary" in body
    assert "issues" in body
    for issue in body["issues"]:
        assert "file" in issue
        assert "severity" in issue
        assert "fix_id" in issue
        assert issue["category"] in ("dead_code", "architecture")


@pytest.mark.asyncio
async def test_analyze_repo_rejects_bad_url(client):
    async with client as c:
        r = await c.post("/analyze/repo", json={
            "github_url": "not-a-url",
            "max_files": 3,
        })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_analyze_repo_rejects_missing_url(client):
    async with client as c:
        r = await c.post("/analyze/repo", json={})
    assert r.status_code == 422  # Pydantic validation error


# ── Preview endpoint (integration) ────────────────────────────────────

@skip_integration
@pytest.mark.asyncio
async def test_preview_unsupported_type(client):
    async with client as c:
        r = await c.post("/preview/fix", json={
            "github_url": SAMPLE_REPO,
            "fix_id": "architecture:src/click/core.py:100:god_object",
        }, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["supported"] is False
    assert body["risk"] == "medium"


@pytest.mark.asyncio
async def test_preview_rejects_bad_fix_id(client):
    async with client as c:
        r = await c.post("/preview/fix", json={
            "github_url": SAMPLE_REPO,
            "fix_id": "bad",
        })
    assert r.status_code == 400


# ── Apply endpoint ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_apply_rejects_empty_fix_ids(client):
    async with client as c:
        r = await c.post("/apply/fixes", json={
            "github_url": SAMPLE_REPO,
            "fix_ids": [],
        })
    assert r.status_code == 422  # Pydantic min_length=1


@pytest.mark.asyncio
async def test_apply_rejects_bad_fix_id(client):
    async with client as c:
        r = await c.post("/apply/fixes", json={
            "github_url": SAMPLE_REPO,
            "fix_ids": ["bad"],
        })
    assert r.status_code == 400
