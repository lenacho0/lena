#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is required." >&2
  exit 1
fi

if [[ -z "${SCRIPT_GENERATION_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" && -z "${GEMINI_API_KEY:-}" ]]; then
  echo "ERROR: SCRIPT_GENERATION_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY is required." >&2
  exit 1
fi

PORT_VALUE="${PORT:-3000}"
API_LOG_PATH="/tmp/vvs_go_live_gate_api.log"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "${API_PID}" >/dev/null 2>&1 || true
    wait "${API_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

echo "[1/3] release preflight"
npm run release:preflight

echo "[2/3] fault drill tests (429 + invalid_response)"
npm run test:integration:fault-drill

echo "[3/3] api health smoke"
node src/server.js >"${API_LOG_PATH}" 2>&1 &
API_PID=$!
sleep 1

HEALTH_BODY="$(curl -sf "http://127.0.0.1:${PORT_VALUE}/health")"
if [[ "${HEALTH_BODY}" != *'"ok":true'* ]]; then
  echo "ERROR: /health response does not contain ok=true." >&2
  echo "health body: ${HEALTH_BODY}" >&2
  exit 1
fi

echo "PASS: go-live gate completed."
