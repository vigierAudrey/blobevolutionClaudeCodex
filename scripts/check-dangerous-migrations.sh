#!/usr/bin/env bash
# CHECK DANGEROUS MIGRATIONS
#
# Scans NEW migration files (added/modified in this PR vs origin/main, or HEAD~1 on branch push)
# for unguarded destructive DDL.
#
# DANGEROUS patterns requiring explicit approval:
#   - DROP TABLE [IF EXISTS] — data loss, irreversible without restore
#   - DROP COLUMN [IF EXISTS] — data loss, irreversible without restore
#   - DROP TYPE [IF EXISTS] — enum/type removal, can break app code
#   - TRUNCATE TABLE — complete data wipe
#
# NOT flagged (reversible or infrastructure-level):
#   - DROP INDEX — fully reversible (can recreate)
#   - DROP CONSTRAINT — reversible (can re-add)
#   - ALTER COLUMN ... DROP NOT NULL — relaxes constraint, backward compatible
#   - DROP EXTENSION — infra concern, handled by DBA
#
# APPROVAL: add this comment on line 1 or 2 of the migration file:
#   -- DANGEROUS-DDL-APPROVED: <reason>
#
# This check applies only to NEW migration files in the current branch/PR.
# Historical migrations are not retroactively flagged.
#
# Usage:
#   bash scripts/check-dangerous-migrations.sh
#   Exit 0 = OK, Exit 1 = violation detected

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MIGRATIONS_DIR="packages/database/prisma/migrations"
APPROVAL_MARKER='DANGEROUS-DDL-APPROVED'

# Resolve which migration files are NEW in this branch.
# PR context: compare against the base branch (GITHUB_BASE_REF).
# Push context: compare against HEAD~1.
resolve_new_migrations() {
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    local base="origin/${GITHUB_BASE_REF}"
    # Shallow fetch — only tree objects needed for diff, not full history.
    git fetch --depth=100 origin "${GITHUB_BASE_REF}" 2>/dev/null || true
    git diff --name-only --diff-filter=A "${base}...HEAD" 2>/dev/null \
      | grep -E "^packages/database/prisma/migrations/.+/migration\.sql$" || true
  else
    # Non-PR push: check migrations added in the last commit only.
    git diff --name-only --diff-filter=A HEAD~1 2>/dev/null \
      | grep -E "^packages/database/prisma/migrations/.+/migration\.sql$" || true
  fi
}

NEW_MIGRATIONS="$(resolve_new_migrations)"

if [ -z "$NEW_MIGRATIONS" ]; then
  echo "✅ check-dangerous-migrations: no new migration files to check."
  exit 0
fi

VIOLATIONS=""

while IFS= read -r migration_file; do
  [ -f "$migration_file" ] || continue

  # Check for approval marker (first 5 lines — must be at file top).
  has_approval=0
  if head -5 "$migration_file" | grep -q "${APPROVAL_MARKER}"; then
    has_approval=1
  fi

  # Detection strategy: strip all SQL comment lines, then collapse newlines
  # into a single space before grepping. This catches the multi-line bypass:
  #   DROP\nTABLE IF EXISTS "Foo";
  # which line-by-line grep would miss.
  #
  # grep -v '^\s*--': removes comment lines (lines starting with --)
  # tr '\n' ' ': collapses to single line for cross-line pattern matching
  # The resulting string is scanned for destructive DDL keywords.
  collapsed=$(grep -v '^\s*--' "$migration_file" | tr '\n' ' ')

  dangerous_match=""
  if echo "$collapsed" | grep -iqE \
      '(DROP[[:space:]]+(TABLE|COLUMN|TYPE)[[:space:]]|TRUNCATE[[:space:]]+TABLE)'; then
    # Re-extract the original lines for human-readable output.
    dangerous_match=$(grep -inE \
      '(DROP[[:space:]]+(TABLE|COLUMN|TYPE)|TRUNCATE[[:space:]]+TABLE)' \
      "$migration_file" | grep -v '^\s*--' || true)
    # If multi-line, original lines might not show the full pattern.
    # Show what was collapsed to make the issue visible.
    if [ -z "$dangerous_match" ]; then
      dangerous_match="    (multi-line DDL detected — collapsed form: $(echo "$collapsed" | grep -ioE '.{0,40}(DROP|TRUNCATE).{0,40}' | head -3))"
    fi
  fi

  if [ -n "$dangerous_match" ] && [ "$has_approval" -eq 0 ]; then
    VIOLATIONS="${VIOLATIONS}❌ ${migration_file}:\n${dangerous_match}\n"
    VIOLATIONS="${VIOLATIONS}   → Add '-- DANGEROUS-DDL-APPROVED: <reason>' at the top of this file\n\n"
  fi
done <<< "$NEW_MIGRATIONS"

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Unguarded destructive DDL in new migration(s)."
  echo ""
  echo "   Destructive DDL (DROP TABLE, DROP COLUMN, DROP TYPE, TRUNCATE) requires"
  echo "   explicit approval. Add the following comment at the top of the migration:"
  echo ""
  echo "       -- DANGEROUS-DDL-APPROVED: <reason why this is safe>"
  echo ""
  echo "   Violations:"
  printf '%b' "$VIOLATIONS"
  exit 1
fi

echo "✅ check-dangerous-migrations: all new migrations are clean."
