#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

cleanup() {
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

UV_BIN=""
if command -v uv >/dev/null 2>&1; then
  UV_BIN="uv"
elif [ -f "$HOME/.local/bin/uv" ]; then
  UV_BIN="$HOME/.local/bin/uv"
fi

if [ ! -d "$BACKEND_DIR/venv" ]; then
  if [ -n "$UV_BIN" ]; then
    "$UV_BIN" venv "$BACKEND_DIR/venv"
    "$UV_BIN" pip install -r "$BACKEND_DIR/requirements.txt" --python "$BACKEND_DIR/venv/bin/python"
  else
    python3 -m venv "$BACKEND_DIR/venv"
    "$BACKEND_DIR/venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
  fi
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  (cd "$FRONTEND_DIR" && npm install)
fi

(cd "$BACKEND_DIR" && "$BACKEND_DIR/venv/bin/python" -m uvicorn main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

wait
