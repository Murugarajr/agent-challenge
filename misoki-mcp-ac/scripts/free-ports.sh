#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# free-ports.sh — Free the Misoki service ports before startup
#
# Strategy:
#   1. Stop existing Misoki containers with `docker compose down`
#      (this cleanly releases the Docker-mapped ports)
#   2. Kill any remaining LISTENING processes on the ports, but
#      skip Docker daemon processes to avoid breaking Docker itself
#
# Ports freed: 8000 (analysis-service), 3000 (agent), 8080 (web)
#
# Usage:
#   ./scripts/free-ports.sh            # free all three ports
#   ./scripts/free-ports.sh 8080 3000  # free specific ports
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

DEFAULT_PORTS=(8000 3000 8080)
PORTS=("${@:-${DEFAULT_PORTS[@]}}")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Step 1: Gracefully stop any running Misoki containers
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    echo -e "${YELLOW}Stopping existing containers…${NC}"
    (cd "$PROJECT_DIR" && docker compose down --remove-orphans 2>/dev/null) && \
        echo -e "${GREEN}✓${NC} Containers stopped" || \
        echo -e "${YELLOW}⚠${NC} No running containers (or compose file not found)"
    echo ""
fi

# Step 2: Kill non-Docker processes still listening on the ports
for port in "${PORTS[@]}"; do
    # -sTCP:LISTEN ensures we only find servers, not client connections
    pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
    if [ -z "$pids" ]; then
        echo -e "${GREEN}✓${NC} Port ${port} is free"
        continue
    fi

    for pid in $pids; do
        proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")

        # Never kill Docker daemon processes — they manage port mappings
        if [[ "$proc_name" == *"com.docker"* ]] || [[ "$proc_name" == *"docker"* ]] || [[ "$proc_name" == *"Docker"* ]]; then
            echo -e "${YELLOW}⚠${NC} Port ${port}: skipping Docker process PID ${pid} (${proc_name})"
            echo -e "  Run ${YELLOW}docker compose down${NC} in the project that owns this port"
            continue
        fi

        kill -15 "$pid" 2>/dev/null  # try graceful SIGTERM first
        sleep 0.3
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null  # force if still alive
        fi
        echo -e "${GREEN}✓${NC} Port ${port}: killed PID ${pid} (${proc_name})"
    done
done

echo -e "\n${GREEN}Done.${NC}"
