#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# start.sh — Free ports, then bring up the Misoki Docker stack
#
# Usage:
#   ./scripts/start.sh              # docker compose up --build
#   ./scripts/start.sh -d           # detached mode
#   ./scripts/start.sh --no-build   # skip rebuild
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════"
echo "  Misoki — Freeing ports before startup"
echo "═══════════════════════════════════════════════"
"$SCRIPT_DIR/free-ports.sh"
echo ""

echo "═══════════════════════════════════════════════"
echo "  Misoki — Starting Docker Compose"
echo "═══════════════════════════════════════════════"
cd "$PROJECT_DIR"
docker compose up --build "$@"
