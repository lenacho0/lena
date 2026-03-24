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

echo "[1/6] npm ci"
npm ci

echo "[2/6] prisma generate"
npm run prisma:generate

echo "[3/6] prisma validate"
npm run prisma:validate

echo "[4/6] prisma migrate deploy"
npm run prisma:migrate:deploy

echo "[5/6] worker runtime config check"
npm run worker:scripts:check-config

echo "[6/6] integration tests"
npm run test:integration
