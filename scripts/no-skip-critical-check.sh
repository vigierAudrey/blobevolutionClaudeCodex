#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v rg >/dev/null 2>&1; then
  echo "❌ [no-skip-critical-check] ripgrep (rg) required but not found — aborting." >&2
  exit 1
fi

PATTERN='\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|describe)\s*\('
TARGETS=(
  "apps/api/src/modules"
  "apps/api/src/lib"
)

hits=""

for target in "${TARGETS[@]}"; do
  if [[ ! -d "$target" ]]; then
    continue
  fi

  target_hits="$(
    rg -n --pcre2 "$PATTERN" "$target" \
      --glob '**/__tests__/**/*.test.ts' \
      --glob '**/__tests__/**/*.test.tsx' \
      --glob '**/__tests__/**/*.test.js' \
      --glob '**/__tests__/**/*.test.jsx' \
      --glob '**/__tests__/**/*.spec.ts' \
      --glob '**/__tests__/**/*.spec.tsx' \
      --glob '**/__tests__/**/*.spec.js' \
      --glob '**/__tests__/**/*.spec.jsx' || true
  )"

  if [[ -n "$target_hits" ]]; then
    hits="${hits}${target_hits}"$'\n'
  fi
done

if [[ -n "$hits" ]]; then
  echo "❌ Forbidden skipped tests found in critical API suites:"
  printf '%s' "$hits"
  echo "   Remove the skip or convert it to it.todo(...) with explicit rationale."
  exit 1
fi

echo "✅ no-skip-critical-check: no it.skip/test.skip/xit/xdescribe in critical API suites."
