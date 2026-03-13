#!/usr/bin/env bash
# CI BLOCK DB PUSH GUARDRAIL
#
# Bloque toute invocation de `prisma db push` dans les fichiers CI/CD.
# Scanne: .github/workflows, .github/actions, .gitlab, .gitlab-ci.yml
# Détecte: formes directes, pnpm exec, npx, bash -lc, sh -c, pnpm dlx, le script db:push marqué unsafe
# Détecte aussi: prisma db \ (continuation multi-ligne)
#
# Usage:
#   bash scripts/ci-block-db-push.sh
#   Exit 0 = OK, Exit 1 = violation détectée
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

list_ci_files() {
  if [ -d .github/workflows ]; then
    find .github/workflows -type f \( -name '*.yml' -o -name '*.yaml' \) -print0
  fi
  if [ -d .github/actions ]; then
    find .github/actions -type f \( -name '*.yml' -o -name '*.yaml' -o -name '*.sh' \) -print0
  fi
  if [ -d .gitlab ]; then
    find .gitlab -type f \( -name '*.yml' -o -name '*.yaml' -o -name '*.sh' \) -print0
  fi
  if [ -f .gitlab-ci.yml ]; then
    printf '%s\0' .gitlab-ci.yml
  fi
}

# shellcheck disable=SC2016
BLOCKED_SINGLE="$(
  list_ci_files \
    | xargs -0 -r grep -I -nE \
      '^[[:space:]]*(run:[[:space:]]*)?(prisma[[:space:]]+db[[:space:]]+push|pnpm[[:space:]]+exec[[:space:]]+prisma[[:space:]]+db[[:space:]]+push|npx[[:space:]]+prisma[[:space:]]+db[[:space:]]+push|bash[[:space:]]+-lc[[:space:]]+["'"'"']prisma[[:space:]]+db[[:space:]]+push|sh[[:space:]]+-c[[:space:]]+["'"'"']prisma[[:space:]]+db[[:space:]]+push|pnpm[[:space:]]+dlx[[:space:]]+prisma[[:space:]]+db[[:space:]]+push|pnpm[[:space:]]+--filter[[:space:]]+@blobinfini/database[[:space:]]+db:push:unsafe)(["'"'"'])?([[:space:];|&]|$)' \
    || true
)"

BLOCKED_CONTINUATION_FILES="$(
  list_ci_files \
    | xargs -0 -r grep -I -l -E '^[[:space:]]*prisma[[:space:]]+db[[:space:]]*\\[[:space:]]*$' \
    || true
)"
BLOCKED_CONTINUATION=""
if [ -n "$BLOCKED_CONTINUATION_FILES" ]; then
  while IFS= read -r file; do
    if grep -I -nE '^[[:space:]]*push([[:space:]]|$)' "$file" >/dev/null; then
      BLOCKED_CONTINUATION="${BLOCKED_CONTINUATION}${file}"$'\n'
    fi
  done < <(printf '%s\n' "$BLOCKED_CONTINUATION_FILES")
fi

if [ -n "$BLOCKED_SINGLE" ] || [ -n "$BLOCKED_CONTINUATION" ]; then
  echo "❌ Forbidden Prisma db push invocation detected in CI paths."
  if [ -n "$BLOCKED_SINGLE" ]; then
    echo "$BLOCKED_SINGLE"
  fi
  if [ -n "$BLOCKED_CONTINUATION" ]; then
    echo "$BLOCKED_CONTINUATION"
  fi
  exit 1
fi

echo "✅ ci-block-db-push: no forbidden db push invocation in CI paths."
