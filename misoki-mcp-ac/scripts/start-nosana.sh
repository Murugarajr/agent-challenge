#!/usr/bin/env bash
set -euo pipefail

echo "=== Misoki: Starting all services ==="

# ── Analysis service (Python/FastAPI on :8000) ───────────────────────
cd /srv/analysis
OHM_MCP_SRC_PATH=/srv/analysis/vendor/ohm-mcp-src \
  /srv/analysis/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# ── Agent (ElizaOS on :3000) ─────────────────────────────────────────
cd /srv/agent
export MISOKI_ANALYSIS_SERVICE_URL=http://localhost:8000
export SERVER_PORT=3000
export NODE_ENV=production
pnpm start &

# ── Web frontend (Next.js on :8080) ──────────────────────────────────
cd /srv/web
export HOSTNAME=0.0.0.0
export PORT=8080
export ANALYSIS_SERVICE_URL=http://localhost:8000
export AGENT_URL=http://localhost:3000
node server.js &

echo "=== Misoki: All services launched ==="

# Block until any child exits, then propagate its exit code
wait -n
exit $?
