FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --no-cache-dir .

COPY vendor/ohm-mcp-src /app/vendor/ohm-mcp-src

ENV OHM_MCP_SRC_PATH=/app/vendor/ohm-mcp-src

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

