#!/usr/bin/env bash
# test-restore-drill-guards.sh — Tests des garde-fous de restore-postgres-drill.sh
#
# N'exécute AUCUN restore réel : tous les cas testés échouent (refus) avant toute
# connexion, et le cas "dry-run" s'arrête volontairement avant de se connecter.
# Aucune base de données n'est requise.
#
# Usage : bash scripts/test-restore-drill-guards.sh

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRILL="$ROOT_DIR/scripts/restore-postgres-drill.sh"

PASS=0
FAIL=0
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Dump gzip valide (>1024 octets compressés) — contenu non restauré (dry-run only).
VALID_DUMP="$WORKDIR/blob_restore_drill.sql.gz"
head -c 8192 /dev/urandom | base64 | gzip > "$VALID_DUMP"

EMPTY_DUMP="$WORKDIR/empty.sql.gz"
: > "$EMPTY_DUMP"

BADEXT_DUMP="$WORKDIR/dump.bin"
head -c 8192 /dev/urandom | base64 | gzip > "$BADEXT_DUMP"

SAFE_TARGET='postgresql://appuser:secretpw@db.internal:5432/blob_restore_drill'

run_drill() { bash "$DRILL" "$@" 2>&1; }

# assert_refuse "label" -- <env assignments...> -- <args...>
assert_refuse() {
  local label="$1"; shift
  local out code
  out="$("$@" 2>&1)"; code=$?
  if (( code != 0 )); then
    echo "✅ PASS (refus, exit=$code) — $label"
    PASS=$(( PASS + 1 ))
  else
    echo "❌ FAIL (n'a pas refusé) — $label"
    echo "    sortie: $out"
    FAIL=$(( FAIL + 1 ))
  fi
}

assert_ok() {
  local label="$1"; shift
  local out code
  out="$("$@" 2>&1)"; code=$?
  if (( code == 0 )); then
    echo "✅ PASS (succès, exit=0) — $label"
    PASS=$(( PASS + 1 ))
  else
    echo "❌ FAIL (exit=$code attendu 0) — $label"
    echo "    sortie: $out"
    FAIL=$(( FAIL + 1 ))
  fi
}

echo "=== Tests garde-fous restore-postgres-drill.sh ==="

# 1. Cible absente
assert_refuse "cible RESTORE_TARGET_DATABASE_URL absente" \
  env -u RESTORE_TARGET_DATABASE_URL -u DATABASE_URL bash "$DRILL" "$VALID_DUMP" --dry-run

# 2. Cible identique à DATABASE_URL
assert_refuse "cible identique à DATABASE_URL" \
  env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" DATABASE_URL="$SAFE_TARGET" \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 3. Host cible contient 'prod'
assert_refuse "host cible contient prod" \
  env RESTORE_TARGET_DATABASE_URL='postgresql://u:p@prod-db.internal:5432/blob_drill' \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 4. DB cible contient 'production'
assert_refuse "db cible contient production" \
  env RESTORE_TARGET_DATABASE_URL='postgresql://u:p@db.internal:5432/blob_production' \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 5. Pas de marqueur sûr dans le nom de DB
assert_refuse "nom de DB sans marqueur sûr" \
  env RESTORE_TARGET_DATABASE_URL='postgresql://u:p@db.internal:5432/blobconnect' \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 6. Tuple host:port/db identique à DATABASE_URL (chaîne différente)
assert_refuse "tuple host:port/db identique à DATABASE_URL" \
  env RESTORE_TARGET_DATABASE_URL='postgresql://restore_user:p@db.internal:5432/blob_restore_drill' \
      DATABASE_URL='postgresql://other:x@DB.INTERNAL:5432/blob_restore_drill' \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 7. RESTORE_FORBIDDEN_HOSTS
assert_refuse "host dans RESTORE_FORBIDDEN_HOSTS" \
  env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" RESTORE_FORBIDDEN_HOSTS='db.internal' \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 8. NODE_ENV=production sans ALLOW_RESTORE_DRILL
assert_refuse "NODE_ENV=production sans ALLOW_RESTORE_DRILL" \
  env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" NODE_ENV=production \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 9. Dump absent
assert_refuse "dump absent" \
  env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" \
  bash "$DRILL" "$WORKDIR/nope.sql.gz" --dry-run

# 10. Dump vide
assert_refuse "dump vide" \
  env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" \
  bash "$DRILL" "$EMPTY_DUMP" --dry-run

# 11. Extension inattendue
assert_refuse "extension inattendue" \
  env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" \
  bash "$DRILL" "$BADEXT_DUMP" --dry-run

# 12. Dry-run valide → exit 0, et ne restaure rien
assert_ok "dry-run valide passe les garde-fous" \
  env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" \
  bash "$DRILL" "$VALID_DUMP" --dry-run

# 13. Le dry-run ne divulgue pas le mot de passe ni la connection string
DRY_OUT="$(env RESTORE_TARGET_DATABASE_URL="$SAFE_TARGET" \
  bash "$DRILL" "$VALID_DUMP" --dry-run 2>&1)"
if printf '%s' "$DRY_OUT" | grep -q 'secretpw'; then
  echo "❌ FAIL (mot de passe divulgué dans les logs)"
  FAIL=$(( FAIL + 1 ))
else
  echo "✅ PASS (aucun mot de passe dans les logs)"
  PASS=$(( PASS + 1 ))
fi
if printf '%s' "$DRY_OUT" | grep -q 'postgresql://'; then
  echo "❌ FAIL (connection string divulguée dans les logs)"
  FAIL=$(( FAIL + 1 ))
else
  echo "✅ PASS (aucune connection string dans les logs)"
  PASS=$(( PASS + 1 ))
fi

echo "=== Résultat : $PASS réussite(s), $FAIL échec(s) ==="
(( FAIL == 0 )) || exit 1
