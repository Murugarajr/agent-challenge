# Misoki Full-Stack Deployment Guide

## Overview

Misoki is a 3-tier application:
1. **Analysis Service** (Python FastAPI) - AST-based code analysis
2. **ElizaOS Agent** (TypeScript) - Orchestration & AI
3. **Web Frontend** (Next.js) - UI

## Local Development with Docker Compose

```bash
cd misoki-mcp-ac
docker-compose up --build
```

Services:
- Web UI: http://localhost:8080
- Agent: http://localhost:3000
- Analysis: http://localhost:8000

## Nosana deployment

Use the **single all-in-one image** and the job definition at the repo root (multi-container jobs on Nosana were unreliable for this stack).

### Build & push (from challenge repo root)

```bash
cd ..   # agent-challenge root
docker build -f Dockerfile.nosana -t YOUR_DOCKERHUB/misoki-all:latest .
docker push YOUR_DOCKERHUB/misoki-all:latest
```

### Job definition

- **Source of truth:** `../nos_job_def/nosana_eliza_job_definition.json`
- Set `image` to your pushed `misoki-all` tag and configure `env` (model URL, API key, `GITHUB_TOKEN`, Misoki limits). Do not commit real secrets.

### Dashboard vs CLI

- **Dashboard:** paste the JSON and deploy (challenge flow).
- **CLI:** `nosana job post --file ../nos_job_def/nosana_eliza_job_definition.json ...` (add `--confidential` if the file contains secrets).

### Env (typical)

- `OPENAI_BASE_URL`, `OPENAI_API_KEY`, model names  
- `GITHUB_TOKEN` (for analysis + draft PR route)  
- `MISOKI_*` analysis limits / timeouts as in the JSON example

## Health Checks

| Service | Endpoint | Port |
|---------|----------|------|
| Analysis | `/health` | 8000 |
| Agent | `/api/health` | 3000 |
| Web | `/` | 8080 |

## Troubleshooting

```bash
# Check logs
docker-compose logs analysis-service
docker-compose logs agent
docker-compose logs web

# Restart service
docker-compose restart analysis-service
```
