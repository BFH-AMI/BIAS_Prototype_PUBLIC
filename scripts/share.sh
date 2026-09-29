#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8000}"

if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
else
  PYTHON_BIN="${PYTHON_BIN:-python}"
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Error: cloudflared is not installed."
  echo "Install with: brew install cloudflared"
  exit 1
fi

echo "Starting BIAS web app on http://$APP_HOST:$APP_PORT ..."
"$PYTHON_BIN" -m uvicorn app:app --reload --host "$APP_HOST" --port "$APP_PORT" >/tmp/bias_webtool_app.log 2>&1 &
APP_PID=$!

cleanup() {
  if kill -0 "$APP_PID" >/dev/null 2>&1; then
    kill "$APP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "Waiting for app to become ready..."
for _ in {1..40}; do
  if curl -fsS "http://$APP_HOST:$APP_PORT/api/overview" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

echo
echo "App is running. Starting Cloudflare Tunnel..."
echo "Share the URL shown below with evaluators."
echo "Press Ctrl+C to stop both tunnel and app."
echo

cloudflared tunnel --url "http://$APP_HOST:$APP_PORT"