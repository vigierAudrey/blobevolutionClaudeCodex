#!/usr/bin/env bash
set -euo pipefail

# Build the static Storybook output
npm run build-storybook --workspace @blobinfini/web >/dev/null

# Clean up any existing servers on port 6006
pkill -f "http-server.*6006" >/dev/null 2>&1 || true
sleep 1

# Serve the static build so the test runner can hit it
npx http-server apps/web/storybook-static -p 6006 --silent &
SERVER_PID=$!
function cleanup() {
  if ps -p "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Wait until Storybook is available before launching tests
npx wait-on http://127.0.0.1:6006

# Run test-storybook from the workspace to ensure correct package resolution
# Note: Do NOT use --index-json flag as it causes SWC target errors with ES2023
npm run test:storybook --workspace @blobinfini/web -- --url http://127.0.0.1:6006
