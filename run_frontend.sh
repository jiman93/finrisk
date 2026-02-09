#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/src/frontend"

cd "$FRONTEND_DIR"

if [[ ! -d "node_modules" ]]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

echo "Starting frontend on http://127.0.0.1:5173"
exec npm run dev -- --host 0.0.0.0 --port 5173
