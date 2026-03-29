# Misoki Analysis Service

FastAPI service that fetches a public GitHub repository, filters Python files, runs a curated subset of `ohm-mcp` analyzers, and returns normalized repo-level analysis results.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

If local Python SSL certificates are broken, you can disable GitHub TLS verification for development only:

```bash
MISOKI_VERIFY_SSL=false uvicorn app.main:app --reload --port 8000
```

Useful tuning flags for local development:

```bash
MISOKI_VERIFY_SSL=false \
MISOKI_MAX_CONCURRENT_FILE_FETCHES=5 \
MISOKI_REQUEST_TIMEOUT_SECONDS=20 \
uvicorn app.main:app --reload --port 8000
```

## Endpoints

- `GET /health`
- `POST /analyze/repo`
- `POST /preview/fix`
