#!/usr/bin/env bash
set -euo pipefail

PATTERN='ERR_ERL_CREATED_IN_REQUEST_HANDLER'
SEARCH_DIRS=(
  "logs"
  "apps/api/logs"
)

found=0

for dir in "${SEARCH_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    continue
  fi

  if grep -R -n "$PATTERN" "$dir"; then
    echo "Runtime regression detected in $dir: $PATTERN"
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  exit 1
fi

echo "No runtime ERL handler regression found in logs."
