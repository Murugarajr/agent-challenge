# Misoki — Deployment Guide

## Architecture Overview

```
┌─────────────────────────┐
│  Web Frontend (Next.js)  │  :8080
│  Repo input · Dashboard  │
│  Diff viewer · Chat      │
└────────────┬────────────┘
             │ REST
┌────────────▼────────────┐
│  ElizaOS Agent (TS)      │  :3000
│  Orchestration · Memory  │
│  Nosana LLM · Misoki     │
│  plugin                  │
└────────────┬────────────┘
             │ HTTP
┌────────────▼────────────┐
│  Analysis Service (Py)   │  :8000
│  FastAPI · ohm-mcp       │
│  AST analysis · Diffs    │
└──────────────────────────┘
```

## 1. Local Development

### Prerequisites

- Python 3.11+
- Node.js 20+
- pnpm (for ElizaOS agent)
- npm (for web frontend)
- `ohm-mcp` source directory accessible (set `OHM_MCP_SRC_PATH`)

### Analysis Service

```bash
cd misoki-mcp-ac/analysis-service
pip install -e ".[test]"

# Run the service
uvicorn app.main:app --reload --port 8000

# Run tests
python -m pytest tests/ -v
```

### ElizaOS Agent

```bash
cd agent-challenge
cp .env.example .env
# Edit .env with your Nosana endpoint and API key
pnpm install
pnpm start
```

### Web Frontend

```bash
cd misoki-mcp-ac/web
cp .env.example .env.local
# Edit .env.local if needed (defaults work for local dev)
npm install
npm run dev
```

Open `http://localhost:8080`.

## 2. Docker Compose

The `docker-compose.yml` in `misoki-mcp-ac/` orchestrates all three services.

```bash
cd misoki-mcp-ac

# Set required environment variables
export NOSANA_MODEL_ENDPOINT="https://your-nosana-endpoint/v1"
export NOSANA_API_KEY="your-api-key"
export OHM_MCP_SRC_PATH="/path/to/ohm-mcp/src"  # optional

# Build and run
docker compose up --build
```

Services:
- Analysis service: `http://localhost:8000`
- ElizaOS agent: `http://localhost:3000`
- Web frontend: `http://localhost:8080`

### Health Checks

The compose file includes health checks:
- Analysis service: `GET /health` every 15s
- Web frontend: `wget http://localhost:3000/` every 20s
- Agent starts only after analysis service is healthy

## 3. Environment Variables

### Analysis Service

| Variable                          | Default                    | Description                              |
| --------------------------------- | -------------------------- | ---------------------------------------- |
| `MISOKI_GITHUB_API_BASE`          | `https://api.github.com`   | GitHub API base URL                      |
| `MISOKI_REQUEST_TIMEOUT_SECONDS`  | `20`                       | HTTP timeout for GitHub API calls        |
| `MISOKI_MAX_FILE_BYTES`           | `200000`                   | Max size per file (bytes)                |
| `MISOKI_MAX_REPO_FILES`           | `40`                       | Max files to scan per repo               |
| `MISOKI_MAX_CONCURRENT_FILE_FETCHES` | `5`                     | Parallel GitHub file fetches             |
| `MISOKI_VERIFY_SSL`               | `true`                     | Verify SSL for GitHub API                |
| `OHM_MCP_SRC_PATH`               | *(auto-detected)*          | Path to `ohm-mcp/src` directory          |
| `GITHUB_TOKEN`                    | *(none)*                   | GitHub token for higher rate limits      |

### ElizaOS Agent

| Variable                       | Default                   | Description                              |
| ------------------------------ | ------------------------- | ---------------------------------------- |
| `OPENAI_BASE_URL`              | *(required)*              | Nosana chat completions endpoint         |
| `OPENAI_API_KEY`               | *(required)*              | Nosana API key                           |
| `OPENAI_LARGE_MODEL`           | `Qwen3.5-27B-AWQ-4bit`   | Model name for text generation           |
| `MISOKI_ANALYSIS_SERVICE_URL`  | `http://127.0.0.1:8000`  | URL of the analysis service              |
| `MISOKI_ANALYSIS_MAX_FILES`    | `3`                       | Max files for agent-initiated analysis   |
| `MISOKI_ANALYSIS_TIMEOUT_MS`   | `30000`                   | Timeout for analysis service calls       |
| `MISOKI_GITHUB_TOKEN`          | *(none)*                  | GitHub token for PR creation             |
| `MISOKI_GITHUB_TARGET_REPO`    | *(same as analyzed repo)* | Target repo for PRs (owner/repo format)  |

### Web Frontend

| Variable                            | Default                  | Description                          |
| ----------------------------------- | ------------------------ | ------------------------------------ |
| `NEXT_PUBLIC_ANALYSIS_SERVICE_URL`  | `http://localhost:8000`  | Analysis service URL for API calls   |
| `NEXT_PUBLIC_AGENT_URL`             | `http://localhost:3000`  | ElizaOS agent URL for chat proxy     |

## 4. Nosana Deployment

### Build and Push Docker Images

```bash
# Analysis service
docker build -t yourusername/misoki-analysis:latest ./misoki-mcp-ac/analysis-service
docker push yourusername/misoki-analysis:latest

# Agent
docker build -t yourusername/misoki-agent:latest .
docker push yourusername/misoki-agent:latest

# Web
docker build -t yourusername/misoki-web:latest ./misoki-mcp-ac/web
docker push yourusername/misoki-web:latest
```

### Nosana Job Definition

See `nos_job_def/nosana_eliza_job_definition.json` for the base job template. Update:
- `image` to your Docker Hub image
- `env.OPENAI_API_URL` to the Nosana model endpoint
- Add `MISOKI_ANALYSIS_SERVICE_URL` pointing to the analysis service

### Production Checklist

- [ ] Set real `OPENAI_BASE_URL` and `OPENAI_API_KEY` for Nosana inference
- [ ] Set `GITHUB_TOKEN` for analysis (higher rate limits)
- [ ] Set `MISOKI_GITHUB_TOKEN` with repo write access if PR creation is needed
- [ ] Restrict CORS origins in `app/main.py` (currently `allow_origins=["*"]`)
- [ ] Validate all three services are reachable from each other
- [ ] Run the E2E validation script: `./misoki-mcp-ac/scripts/e2e-validate.sh`
- [ ] Test with a known demo repo before the live demo
