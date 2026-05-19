#!/usr/bin/env bash
# check-metrics-not-stub.sh
# CI guard: verifies that /internal/metrics does not return the old stub
# response ({ ok: true, ts: ... }) and that it exposes the real snapshot fields.
#
# Checks performed (static — no running server required):
#  1. The handler must not contain `{ ok: true, ts:` (stub pattern).
#  2. The handler must reference getHttpMetricsSnapshot(), getMatchingMetricsSnapshot(),
#     getLogTransportMetrics(), and process.memoryUsage() — the real snapshot building blocks.
#  3. timingSafeEqual must be used in the /internal/metrics handler (timing-safe token compare).
#
# Add this script to .github/workflows/ci.yml under the security-guards job.

set -euo pipefail

METRICS_FILE="apps/api/src/index.ts"

if [[ ! -f "$METRICS_FILE" ]]; then
  echo "ERROR: $METRICS_FILE not found"
  exit 1
fi

ERRORS=0

# ── Check 1: stub pattern must be absent ──────────────────────────────────────
if grep -qE "res\.json\(\s*\{\s*ok:\s*true,\s*ts:" "$METRICS_FILE"; then
  echo "FAIL [stub-present]: /internal/metrics still returns stub { ok: true, ts: ... }"
  echo "  Replace with real snapshot in $METRICS_FILE"
  ERRORS=$((ERRORS + 1))
else
  echo "OK   [stub-absent]: stub pattern not found"
fi

# ── Check 2: real snapshot functions must be present ─────────────────────────
for SYMBOL in "getHttpMetricsSnapshot" "getMatchingMetricsSnapshot" "getLogTransportMetrics" "process.memoryUsage"; do
  if ! grep -q "$SYMBOL" "$METRICS_FILE"; then
    echo "FAIL [missing-symbol]: $SYMBOL not found in $METRICS_FILE"
    echo "  /internal/metrics must aggregate real metrics"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK   [symbol-present]: $SYMBOL found"
  fi
done

# ── Check 3: timingSafeEqual must be used for token comparison ─────────────
if ! grep -q "timingSafeEqual" "$METRICS_FILE"; then
  echo "FAIL [timing-unsafe]: timingSafeEqual not found in $METRICS_FILE"
  echo "  Token comparison for /internal/metrics must use timingSafeEqual"
  ERRORS=$((ERRORS + 1))
else
  echo "OK   [timing-safe]: timingSafeEqual found"
fi

if [[ "$ERRORS" -gt 0 ]]; then
  echo ""
  echo "check-metrics-not-stub: $ERRORS error(s) — FAILING"
  exit 1
fi

echo ""
echo "check-metrics-not-stub: all checks passed"
