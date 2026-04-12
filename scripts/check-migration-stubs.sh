#!/usr/bin/env bash
# CHECK MIGRATION STUBS
#
# Scans ALL migration.sql files for SELECT 1 stubs without justification.
#
# A "stub" is a migration.sql that contains NO DDL — only SELECT 1; (or equivalent no-op).
# Stubs that exist without documented justification are silent coverage gaps:
# they give the appearance of a migration while hiding a missing schema object.
#
# WHAT COUNTS AS A STUB:
#   - The only non-comment, non-whitespace SQL is SELECT 1; (or SELECT 1)
#
# WHAT IS REQUIRED:
#   - A comment explaining WHY the migration is a stub.
#   - Required pattern (case-insensitive): stub | no-op | noop | intentionally empty
#
# CORRECT example:
#   -- Stub no-op: index already applied via db push, no longer needed in schema.
#   SELECT 1;
#
# INCORRECT example (will FAIL):
#   SELECT 1;
#
# This check applies to ALL migrations (not just new ones), because a new
# unjustified stub in any migration is a coverage gap regardless of when it was added.
#
# Usage:
#   bash scripts/check-migration-stubs.sh
#   Exit 0 = OK, Exit 1 = violation detected

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MIGRATIONS_DIR="packages/database/prisma/migrations"
VIOLATIONS=""

while IFS= read -r -d '' sql_file; do
  # Extract non-comment, non-whitespace lines.
  # A comment line is one that starts (after optional spaces) with "--".
  real_lines=""
  while IFS= read -r line; do
    stripped="${line#"${line%%[![:space:]]*}"}"  # ltrim whitespace
    # Skip blank lines
    [ -z "$stripped" ] && continue
    # Skip comment lines
    case "$stripped" in
      --*) continue ;;
    esac
    real_lines="${real_lines}${stripped}"$'\n'
  done < "$sql_file"

  # Normalize: remove trailing semicolons and whitespace for comparison
  normalized="$(printf '%s' "$real_lines" | tr -d '[:space:];')"

  # A stub has no real DDL — only SELECT 1 (case-insensitive)
  if [ -z "$normalized" ] || [ "${normalized,,}" = "select1" ]; then
    # Is there a justification comment?
    if ! grep -qiE '(stub|no-op|noop|intentionally[[:space:]]+empty)' "$sql_file"; then
      VIOLATIONS="${VIOLATIONS}❌ ${sql_file}: SELECT 1 stub without justification comment\n"
      VIOLATIONS="${VIOLATIONS}   → Add: '-- Stub no-op: <reason why this migration is a no-op>'\n\n"
    fi
  fi
done < <(find "${MIGRATIONS_DIR}" -name 'migration.sql' -print0 | sort -z)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ Unjustified migration stub(s) detected."
  echo ""
  echo "   Migration stubs (SELECT 1 only) MUST include a comment explaining:"
  echo "   - Why this migration is a no-op"
  echo "   - What object was supposed to be created/modified"
  echo "   - Why the stub is safe (object already exists, never needed, etc.)"
  echo ""
  echo "   Violations:"
  printf '%b' "$VIOLATIONS"
  exit 1
fi

echo "✅ check-migration-stubs: all stubs are justified."
