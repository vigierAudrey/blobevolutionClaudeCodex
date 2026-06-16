#!/usr/bin/env bash
# check-minio-backup.sh — Tests statiques du script de backup MinIO.
#
# N'exécute AUCUN backup réel et ne requiert PAS de daemon Docker : les seules
# exécutions sont des chemins d'échec précoce (compose file absent) qui sortent
# avant toute écriture. Conçu pour tourner en CI (pas de VPS, pas de secret).
#
# Assertions :
#   1. bash -n (syntaxe) + shebang exécutable
#   2. défaut DC_PROJECT=blobconnect-vps présent ET surchargeable
#   3. aucun secret MinIO/S3 hardcodé (méthode volume = zéro credential)
#   4. refus propre si compose file absent, sans créer de dossier backup
#   5. le mode --dry-run sort AVANT toute écriture/suppression (mkdir/rm/docker run)
#
# Usage: bash scripts/check-minio-backup.sh   (exit 0 = OK, 1 = échec)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/backup-minio.sh"
ERRORS=0

_fail() { echo "❌ $*"; ERRORS=$(( ERRORS + 1 )); }
_ok()   { echo "✅ $*"; }

[[ -f "$SCRIPT" ]] || { echo "❌ check-minio-backup: script introuvable: $SCRIPT"; exit 1; }

# ─── 1. Syntaxe + exécutable ──────────────────────────────────────────────────
if bash -n "$SCRIPT" 2>/tmp/check-minio-syntax-err; then
  _ok "bash -n OK"
else
  _fail "erreur de syntaxe bash"; cat /tmp/check-minio-syntax-err
fi
[[ -x "$SCRIPT" ]] && _ok "script exécutable" || _fail "script non exécutable (chmod +x)"

# ─── 2. Défaut blobconnect-vps + override ─────────────────────────────────────
if grep -Eq 'DC_PROJECT="\$\{DC_PROJECT:-blobconnect-vps\}"' "$SCRIPT"; then
  _ok "défaut DC_PROJECT=blobconnect-vps surchargeable"
else
  _fail "défaut DC_PROJECT=blobconnect-vps (surchargeable) manquant"
fi

# ─── 3. Aucun secret hardcodé ─────────────────────────────────────────────────
# La méthode volume ne lit aucun credential : toute affectation littérale d'une
# variable de secret, ou clé AWS/MinIO en dur, est interdite.
if grep -nEi '(S3_SECRET_ACCESS_KEY|S3_ACCESS_KEY_ID|MINIO_ROOT_PASSWORD|SECRET_KEY)[[:space:]]*=[[:space:]]*["'"'"']?[A-Za-z0-9/+]{8,}' "$SCRIPT" \
   || grep -nE 'AKIA[0-9A-Z]{16}' "$SCRIPT"; then
  _fail "secret potentiellement hardcodé détecté"
else
  _ok "aucun secret hardcodé"
fi
# La méthode ne doit pas non plus injecter de credential dans `docker run -e`.
if grep -nE 'docker run.*-e[[:space:]]+MC_HOST|docker run.*SECRET|docker run.*ACCESS_KEY' "$SCRIPT"; then
  _fail "credential injecté dans docker run (-e ...)"
else
  _ok "aucun credential injecté dans docker run"
fi

# ─── 4. Refus si compose file absent, sans créer de dossier ───────────────────
TEST_BK="$(mktemp -d)/should-not-exist"
set +e
COMPOSE_FILE="/nonexistent/docker-compose.vps.yml" BACKUP_DIR="$TEST_BK" \
  bash "$SCRIPT" --dry-run >/dev/null 2>&1
rc=$?
set -e
if [[ $rc -ne 0 && ! -d "$TEST_BK" ]]; then
  _ok "refus propre si compose absent (exit $rc, aucun dossier créé)"
else
  _fail "compose absent : exit=$rc, dossier créé=$( [[ -d "$TEST_BK" ]] && echo oui || echo non )"
fi
rm -rf "$(dirname "$TEST_BK")"

# ─── 5. --dry-run sort avant toute écriture/suppression ───────────────────────
DRY_EXIT_LINE=$(grep -nE '^if \[\[ "\$DRY_RUN" -eq 1 \]\]; then' "$SCRIPT" | head -1 | cut -d: -f1)
MKDIR_LINE=$(grep -nE 'mkdir -p "\$BACKUP_DIR_ABS"' "$SCRIPT" | head -1 | cut -d: -f1)
TAR_LINE=$(grep -nE 'docker run --rm' "$SCRIPT" | head -1 | cut -d: -f1)
FIRST_RM_LINE=$(grep -nE '[^.]rm -f ' "$SCRIPT" | head -1 | cut -d: -f1)
if [[ -n "$DRY_EXIT_LINE" && -n "$MKDIR_LINE" && "$DRY_EXIT_LINE" -lt "$MKDIR_LINE" \
      && -n "$TAR_LINE" && "$DRY_EXIT_LINE" -lt "$TAR_LINE" ]]; then
  _ok "--dry-run sort avant mkdir/docker run (write-safe)"
else
  _fail "le bloc --dry-run ne précède pas clairement les écritures (dry=$DRY_EXIT_LINE mkdir=$MKDIR_LINE tar=$TAR_LINE)"
fi

rm -f /tmp/check-minio-syntax-err

if [[ $ERRORS -gt 0 ]]; then
  echo "❌ check-minio-backup: $ERRORS échec(s)."
  exit 1
fi
echo "✅ check-minio-backup: tous les tests statiques passent."
