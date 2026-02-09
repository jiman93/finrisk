#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/src/backend"
VENV_PATH="$BACKEND_DIR/.venv"

if [[ ! -d "$VENV_PATH" ]]; then
  echo "Backend virtual environment not found at: $VENV_PATH"
  echo "Create it first:"
  echo "  cd \"$BACKEND_DIR\" && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

source "$VENV_PATH/bin/activate"
cd "$BACKEND_DIR"

echo "Starting backend on http://127.0.0.1:8000"
exec python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
