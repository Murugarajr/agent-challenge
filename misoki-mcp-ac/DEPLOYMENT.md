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

## Nosana Deployment

### Prerequisites
- Docker images pushed to registry
- Nosana CLI installed
- GPU node access for ElizaOS agent

### Build & Push Images

```bash
# Build all images
docker build -t misoki/analysis-service:latest ./analysis-service
docker build -t misoki/eliza-agent:latest ..
docker build -t misoki/web:latest ./web

# Push to registry
docker push misoki/analysis-service:latest
docker push misoki/eliza-agent:latest
docker push misoki/web:latest
```

### Deploy to Nosana

```bash
# Using the job definition
nosana job run -f nosana-job.json

# Or deploy individual services
nosana container deploy misoki/analysis-service:latest --port 8000
```

### Required Secrets

Set these in your Nosana project:
- `NOSANA_API_KEY` - Your Nosana API key
- `NOSANA_MODEL_ENDPOINT` - Qwen3.5-27B-AWQ endpoint URL
- `GITHUB_TOKEN` - Optional, for private repos

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
