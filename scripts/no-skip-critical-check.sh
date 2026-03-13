#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PATTERN='\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|describe)\s*\('
TARGETS=(
  "apps/api/src/modules"
  "apps/api/src/lib"
)

EXTS=(
  '*.test.ts'
  '*.test.tsx'
  '*.test.js'
  '*.test.jsx'
  '*.spec.ts'
  '*.spec.tsx'
  '*.spec.js'
  '*.spec.jsx'
)

hits=""

for target in "${TARGETS[@]}"; do
  if [[ ! -d "$target" ]]; then
    continue
  fi

  include_args=()
  for ext in "${EXTS[@]}"; do
    include_args+=("--include=$ext")
  done

  target_hits="$(
    grep -rPn "${include_args[@]}" --exclude-dir=node_modules "$PATTERN" "$target" || true
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
