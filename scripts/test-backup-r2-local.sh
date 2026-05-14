#!/usr/bin/env bash
# test-backup-r2-local.sh — Validation locale du système backup R2 chiffré
#
# Aucune connexion R2, aucun age réel requis — tout est mocké.
# Prouve les propriétés critiques avant installation VPS.
#
# Usage :
#   bash scripts/test-backup-r2-local.sh
#   bash scripts/test-backup-r2-local.sh --verbose
#
# Exit 0 = tous les tests passent (SAFE TO MERGE)
# Exit 1 = un ou plusieurs tests échouent (NOT SAFE)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERBOSE=false
[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

PASS=0
FAIL=0
TMPROOT="$(mktemp -d /tmp/test-backup-r2-XXXXXXXX)"
trap 'rm -rf "$TMPROOT"' EXIT

# ─── Helpers affichage ────────────────────────────────────────────────────────
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

log_pass() { green "  ✅ PASS: $*"; PASS=$(( PASS + 1 )); }
log_fail() { red   "  ❌ FAIL: $*"; FAIL=$(( FAIL + 1 )); }
log_test() { printf '\n'; bold "[ T%-2s ] %s" "$1" "$2"; }
vlog()     { $VERBOSE && printf '       %s\n' "$*" || true; }

# ─── Setup mock executables ───────────────────────────────────────────────────
MOCK_BIN="$TMPROOT/mock-bin"
mkdir -p "$MOCK_BIN"

RCLONE_CALLS="$TMPROOT/rclone-calls.log"
touch "$RCLONE_CALLS"

# Mock age : chiffrement simulé avec vrai header ASCII age
cat > "$MOCK_BIN/age" << 'MOCK_AGE'
#!/usr/bin/env bash
OUT="" IN="" DECRYPT=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r)  shift 2 ;;
    -o)  OUT="$2"; shift 2 ;;
    -d)  DECRYPT=true; shift ;;
    -i)  shift 2 ;;
    *)   IN="$1"; shift ;;
  esac
done
if $DECRYPT; then
  sed '1d' "${IN:--}" > "${OUT:--}"
else
  # Format header identique au vrai age (vérifié dans r2-restore-test.sh)
  { printf 'age-encryption.org/v1\n'; cat "${IN:--}"; } > "${OUT:--}"
fi
MOCK_AGE
chmod +x "$MOCK_BIN/age"

# Mock age-keygen
cat > "$MOCK_BIN/age-keygen" << 'MOCK_KEYGEN'
#!/usr/bin/env bash
if [[ "${1:-}" == "-y" ]]; then
  echo "age1testpublickeymockxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
elif [[ "${1:-}" == "-o" ]]; then
  { echo "# created: 2026-05-13T00:00:00Z"
    echo "# public key: age1testpublickeymockxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    echo "AGE-SECRET-KEY-1TESTMOCKXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  } > "$2"
fi
MOCK_KEYGEN
chmod +x "$MOCK_BIN/age-keygen"

# Mock rclone : comportement configurable via env
# RCLONE_MOCK_FAIL_COPY=1 → copy retourne exit 1
# RCLONE_MOCK_FAIL_SIZE=1 → size retourne {"bytes":0}
# RCLONE_MOCK_LSF_FILES="..." → lsf retourne ce contenu
cat > "$MOCK_BIN/rclone" << 'MOCK_RCLONE'
#!/usr/bin/env bash
echo "$*" >> "${RCLONE_CALLS_FILE:-/dev/null}"
subcmd="${1:-}"
case "$subcmd" in
  listremotes) echo "r2-test:" ;;
  lsd)         exit 0 ;;
  copy)
    if [[ "${RCLONE_MOCK_FAIL_COPY:-0}" == "1" ]]; then
      echo "mock rclone copy: simulated failure" >&2; exit 1
    fi
    exit 0 ;;
  size)
    if [[ "${RCLONE_MOCK_FAIL_SIZE:-0}" == "1" ]]; then
      printf '{"count":0,"bytes":0}\n'
    else
      printf '{"count":1,"bytes":9999}\n'
    fi ;;
  lsf)
    printf '%s' "${RCLONE_MOCK_LSF_FILES:-}" ;;
  deletefile|delete)
    if [[ "${RCLONE_MOCK_FAIL_DELETE:-0}" == "1" ]]; then exit 1; fi
    exit 0 ;;
esac
exit 0
MOCK_RCLONE
chmod +x "$MOCK_BIN/rclone"

# ─── Setup env commun ─────────────────────────────────────────────────────────
BASE_ENV="$TMPROOT/base.env"
cat > "$BASE_ENV" << 'BASEENV'
APP_ENV=test
NODE_ENV=test
BACKUP_AGE_RECIPIENT=age1testpublickeymockxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BASEENV

export PATH="$MOCK_BIN:$PATH"
export RCLONE_CALLS_FILE="$RCLONE_CALLS"

# ─── Helper : créer un backup de test ─────────────────────────────────────────
make_backup_dir() {
  local d="$TMPROOT/$1"
  mkdir -p "$d/pg" "$d/logs"
  echo "$d"
}

make_backup_file() {
  local dir="$1" name="$2" size="${3:-512}"
  local path="$dir/pg/$name"
  if (( size > 0 )); then
    dd if=/dev/urandom bs=1 count="$size" 2>/dev/null > "$path"
  else
    : > "$path"   # fichier vide
  fi
  echo "$path"
}

run_upload() {
  local bdir="$1"
  shift
  env "$@" \
    ENV_FILE="$BASE_ENV" \
    BACKUP_DIR="$bdir" \
    RCLONE_REMOTE=r2-test \
    R2_BUCKET=test-bucket \
    UPLOAD_WINDOW_HOURS=9999 \
    bash "$SCRIPT_DIR/backup-encrypt-upload.sh" 2>&1
}

# ══════════════════════════════════════════════════════════════════════════════
log_test 1 "Nom final .age sur R2 (pas .age.tmp)"
# ══════════════════════════════════════════════════════════════════════════════
BD1="$(make_backup_dir t1)"
BF1="$(make_backup_file "$BD1" "blobsurf_2026-05-13_030000.sql.gz" 512)"

truncate -s 0 "$RCLONE_CALLS"
run_upload "$BD1" > "$TMPROOT/t1.log" 2>&1 || true

# Toutes les lignes "copy" dans les appels rclone
COPY_CALLS="$(grep '^copy' "$RCLONE_CALLS" || true)"
vlog "rclone calls copy: $COPY_CALLS"

# Le fichier passé à rclone copy doit finir en .age (pas .age.tmp)
if echo "$COPY_CALLS" | grep -qE '\.age[[:space:]]'; then
  log_pass "rclone copy reçoit un fichier *.age"
else
  log_fail "rclone copy ne reçoit pas de fichier *.age"
  vlog "Calls: $COPY_CALLS"
fi

if echo "$COPY_CALLS" | grep -q '\.age\.tmp'; then
  log_fail ".age.tmp transmis à rclone copy — P0 présent"
else
  log_pass "aucun .age.tmp transmis à rclone copy"
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 2 "Marker .r2 posé après upload réussi"
# ══════════════════════════════════════════════════════════════════════════════
if [[ -f "${BF1}.r2" ]]; then
  log_pass "Marker .r2 présent après upload réussi"
else
  log_fail "Marker .r2 ABSENT après upload réussi"
  $VERBOSE && cat "$TMPROOT/t1.log" || true
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 3 "Marker .r2 absent si upload échoue (rclone copy fails)"
# ══════════════════════════════════════════════════════════════════════════════
BD3="$(make_backup_dir t3)"
BF3="$(make_backup_file "$BD3" "blobsurf_2026-05-13_040000.sql.gz" 256)"

RCLONE_MOCK_FAIL_COPY=1 run_upload "$BD3" RCLONE_MOCK_FAIL_COPY=1 > "$TMPROOT/t3.log" 2>&1 || true

if [[ -f "${BF3}.r2" ]]; then
  log_fail "Marker .r2 PRÉSENT malgré échec upload"
else
  log_pass "Marker .r2 absent quand upload échoue"
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 4 "Marker .r2 absent si vérification distante échoue (REMOTE_SIZE=0)"
# ══════════════════════════════════════════════════════════════════════════════
BD4="$(make_backup_dir t4)"
BF4="$(make_backup_file "$BD4" "blobsurf_2026-05-13_050000.sql.gz" 256)"

RCLONE_MOCK_FAIL_SIZE=1 run_upload "$BD4" RCLONE_MOCK_FAIL_SIZE=1 > "$TMPROOT/t4.log" 2>&1 || true

if [[ -f "${BF4}.r2" ]]; then
  log_fail "Marker .r2 PRÉSENT alors que vérification distante = 0 bytes"
else
  log_pass "Marker .r2 absent quand REMOTE_SIZE=0"
fi

if grep -q 'ERREUR CRITIQUE\|INTROUVABLE' "$TMPROOT/t4.log" 2>/dev/null; then
  log_pass "Log contient l'erreur ERREUR CRITIQUE/INTROUVABLE"
else
  log_fail "Log ne contient pas d'erreur pour REMOTE_SIZE=0"
  $VERBOSE && cat "$TMPROOT/t4.log" || true
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 5 "Backup 0 byte refusé avant chiffrement"
# ══════════════════════════════════════════════════════════════════════════════
BD5="$(make_backup_dir t5)"
BF5="$(make_backup_file "$BD5" "blobsurf_2026-05-13_060000.sql.gz" 0)"

run_upload "$BD5" > "$TMPROOT/t5.log" 2>&1 || true

if grep -q 'vide (0 bytes)' "$TMPROOT/t5.log"; then
  log_pass "Backup 0 byte refusé avec message explicite"
else
  log_fail "Backup 0 byte non détecté"
  $VERBOSE && cat "$TMPROOT/t5.log" || true
fi

if [[ -f "${BF5}.r2" ]]; then
  log_fail "Marker .r2 posé sur backup vide"
else
  log_pass "Aucun marker .r2 sur backup vide"
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 6 "Manifest contient 2 hashes : plaintext + .age"
# ══════════════════════════════════════════════════════════════════════════════
MANIFEST_FILE="${BF1}.sha256"
if [[ ! -f "$MANIFEST_FILE" ]]; then
  log_fail "Manifest SHA256 introuvable : $MANIFEST_FILE"
else
  LINE_COUNT="$(wc -l < "$MANIFEST_FILE")"
  vlog "Manifest ($LINE_COUNT lignes) : $(cat "$MANIFEST_FILE")"

  if (( LINE_COUNT >= 2 )); then
    log_pass "Manifest contient ≥2 lignes"
  else
    log_fail "Manifest contient seulement $LINE_COUNT ligne(s), attendu 2"
  fi

  # Ligne 1 : hash du plaintext (nom sans .age)
  L1_NAME="$(awk 'NR==1{print $2}' "$MANIFEST_FILE")"
  if [[ "$L1_NAME" == "blobsurf_2026-05-13_030000.sql.gz" ]]; then
    log_pass "Ligne 1 manifest = SHA256 plaintext (.sql.gz)"
  else
    log_fail "Ligne 1 manifest nom inattendu : $L1_NAME"
  fi

  # Ligne 2 : hash du .age
  L2_NAME="$(awk 'NR==2{print $2}' "$MANIFEST_FILE")"
  if [[ "$L2_NAME" == "blobsurf_2026-05-13_030000.sql.gz.age" ]]; then
    log_pass "Ligne 2 manifest = SHA256 du .age"
  else
    log_fail "Ligne 2 manifest nom inattendu : '$L2_NAME' (attendu: .sql.gz.age)"
  fi

  # Les deux hashes sont en format SHA256 valide (64 hex)
  H1="$(awk 'NR==1{print $1}' "$MANIFEST_FILE")"
  H2="$(awk 'NR==2{print $1}' "$MANIFEST_FILE")"
  if echo "$H1" | grep -qE '^[0-9a-f]{64}$' && echo "$H2" | grep -qE '^[0-9a-f]{64}$'; then
    log_pass "Les 2 hashes ont le bon format SHA256 (64 hex chars)"
  else
    log_fail "Format SHA256 invalide — H1=${H1:0:10}... H2=${H2:0:10}..."
  fi

  # Les deux hashes sont différents (il ne faut pas que plaintext == .age par accident)
  if [[ "$H1" != "$H2" ]]; then
    log_pass "SHA256 plaintext ≠ SHA256 .age (comme attendu)"
  else
    log_fail "SHA256 plaintext == SHA256 .age — anomalie (fichiers identiques ?)"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 7 "r2-restore-test : extraction et vérification SHA256 .age (logique interne)"
# ══════════════════════════════════════════════════════════════════════════════
STAGING="$TMPROOT/staging-t7"
mkdir -p "$STAGING"

# Créer un faux fichier .age avec header valide
FAKE_AGE="$STAGING/backup_test.sql.gz.age"
printf 'age-encryption.org/v1\ncontenu_chiffre_factice_1234567890\n' > "$FAKE_AGE"
REAL_AGE_HASH="$(sha256sum "$FAKE_AGE" | awk '{print $1}')"

# Créer le manifest dans le même format que backup-encrypt-upload.sh produit
FAKE_MANIFEST="$STAGING/backup_test.sql.gz.sha256"
FAKE_PLAINTEXT_HASH="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
printf '%s  backup_test.sql.gz\n' "$FAKE_PLAINTEXT_HASH"  > "$FAKE_MANIFEST"
printf '%s  backup_test.sql.gz.age\n' "$REAL_AGE_HASH"   >> "$FAKE_MANIFEST"

# Reproduire la logique exacte de r2-restore-test.sh
FAKE_BASENAME="backup_test.sql.gz.age"
EXTRACTED="$(awk -v f="$FAKE_BASENAME" '$2==f{print $1}' "$FAKE_MANIFEST" || true)"

if [[ "$EXTRACTED" == "$REAL_AGE_HASH" ]]; then
  log_pass "Extraction SHA256 .age depuis manifest (awk -v f=...) : correct"
else
  log_fail "Extraction SHA256 .age échouée : attendu=${REAL_AGE_HASH:0:16}... obtenu=${EXTRACTED:0:16}..."
fi

# Vérification SHA256 sur fichier intact
ACTUAL_HASH="$(sha256sum "$FAKE_AGE" | awk '{print $1}')"
if [[ "$ACTUAL_HASH" == "$EXTRACTED" ]]; then
  log_pass "Vérification SHA256 .age intact : correspondance correcte"
else
  log_fail "SHA256 mismatch inattendu sur fichier intact"
fi

# Détection d'un fichier .age corrompu
printf 'CORRUPTION\n' >> "$FAKE_AGE"
CORRUPTED_HASH="$(sha256sum "$FAKE_AGE" | awk '{print $1}')"
if [[ "$CORRUPTED_HASH" != "$EXTRACTED" ]]; then
  log_pass "Détection corruption : SHA256 diffère après modification"
else
  log_fail "SHA256 identique après modification — corruption non détectée"
fi

# Cas ancien manifest (1 seule ligne, pas de hash .age) → SHA256_OK doit rester false
OLD_MANIFEST="$STAGING/old.sha256"
printf '%s  backup_test.sql.gz\n' "$FAKE_PLAINTEXT_HASH" > "$OLD_MANIFEST"
EXTRACTED_OLD="$(awk -v f="$FAKE_BASENAME" '$2==f{print $1}' "$OLD_MANIFEST" || true)"
if [[ -z "$EXTRACTED_OLD" ]]; then
  log_pass "Ancien manifest (1 ligne) : SHA256 .age vide → SHA256_OK=false"
else
  log_fail "Ancien manifest : extraction SHA256 .age retourne '$EXTRACTED_OLD' au lieu de vide"
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 8 "Rotation dry-run : aucun appel à deletefile/delete"
# ══════════════════════════════════════════════════════════════════════════════
BD8_ENV="$TMPROOT/t8.env"
cat > "$BD8_ENV" << 'T8ENV'
APP_ENV=test
NODE_ENV=test
T8ENV

truncate -s 0 "$RCLONE_CALLS"

# 35 fichiers PG (rétention=30 → doit identifier 5 à supprimer)
# IMPORTANT : construire avec $'\n' — $(printf '...\n') strips trailing newlines
LSF_FILES=""
for i in $(seq 1 35); do
  LSF_FILES+="$(printf '2026/05/%02d/blobsurf_2026-05-%02d.sql.gz.age' "$i" "$i")"$'\n'
done

RCLONE_MOCK_LSF_FILES="$LSF_FILES" \
  ENV_FILE="$BD8_ENV" \
  RCLONE_REMOTE=r2-test \
  R2_BUCKET=test-bucket \
  R2_RETAIN_PG=30 \
  R2_RETAIN_MINIO=14 \
  bash "$SCRIPT_DIR/r2-rotate.sh" --dry-run > "$TMPROOT/t8.log" 2>&1

# Aucun deletefile ne doit avoir été appelé
if grep -q '^deletefile\|^delete ' "$RCLONE_CALLS" 2>/dev/null; then
  log_fail "deletefile/delete appelé en mode dry-run — ERREUR CRITIQUE"
  $VERBOSE && grep 'deletefile\|delete' "$RCLONE_CALLS" || true
else
  log_pass "Aucun deletefile/delete en dry-run"
fi

# La sortie doit mentionner [DRY-RUN]
if grep -q 'DRY-RUN' "$TMPROOT/t8.log"; then
  log_pass "Log contient [DRY-RUN]"
else
  log_fail "Log ne contient pas [DRY-RUN]"
  $VERBOSE && cat "$TMPROOT/t8.log" || true
fi

# Le log doit identifier des fichiers à supprimer (≥5 Supprimerait pour pg/)
# Note: mock lsf retourne la même liste pour pg/ et minio/ — on vérifie ≥1
# grep | wc -l évite les problèmes de grep -c avec || echo 0
DELETE_COUNT="$(grep 'Supprimerait' "$TMPROOT/t8.log" 2>/dev/null | wc -l)"
if (( DELETE_COUNT >= 5 )); then
  log_pass "Dry-run identifie ${DELETE_COUNT} fichier(s) à supprimer (≥5 attendu)"
else
  log_fail "Dry-run identifie seulement $DELETE_COUNT fichier(s) à supprimer (attendu ≥5)"
  $VERBOSE && cat "$TMPROOT/t8.log" || true
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 9 "r2-rotate n'utilise que deletefile (jamais rclone delete)"
# ══════════════════════════════════════════════════════════════════════════════
# Vérification statique dans le code source
# "rclone delete " avec espace — ne doit pas exister (seulement rclone deletefile)
if grep -Ew 'rclone delete[^f]' "$SCRIPT_DIR/r2-rotate.sh" 2>/dev/null; then
  log_fail "'rclone delete' (préfixe S3) trouvé dans r2-rotate.sh"
else
  log_pass "aucun 'rclone delete' dans r2-rotate.sh (seulement rclone deletefile)"
fi

if grep -q 'rclone sync' "$SCRIPT_DIR/r2-rotate.sh"; then
  log_fail "'rclone sync' trouvé dans r2-rotate.sh"
else
  log_pass "aucun 'rclone sync' dans r2-rotate.sh"
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 10 "setup-backup-keys.sh refuse si APP_ENV=vps détecté"
# ══════════════════════════════════════════════════════════════════════════════
FAKE_VPS_ENV="$TMPROOT/fake-vps.env"
printf 'APP_ENV=vps\nNODE_ENV=production\n' > "$FAKE_VPS_ENV"

# Patcher le chemin .env.vps hardcodé dans le script
PATCHED_SETUP="$TMPROOT/setup-keys-test.sh"
sed "s|/home/audrey/blob-app/.env.vps|${FAKE_VPS_ENV}|g" \
  "$SCRIPT_DIR/setup-backup-keys.sh" > "$PATCHED_SETUP"
chmod +x "$PATCHED_SETUP"

SETUP_OUT="$(bash "$PATCHED_SETUP" 2>&1 || true)"
if echo "$SETUP_OUT" | grep -q 'ERREUR DE SÉCURITÉ'; then
  log_pass "setup-backup-keys.sh refuse avec APP_ENV=vps"
else
  log_fail "setup-backup-keys.sh n'a PAS refusé avec APP_ENV=vps"
  vlog "$SETUP_OUT"
fi

# Sans .env.vps pointant vers vps (env test) → doit continuer (no abort)
FAKE_LOCAL_ENV="$TMPROOT/fake-local.env"
printf 'APP_ENV=local\nNODE_ENV=development\n' > "$FAKE_LOCAL_ENV"
PATCHED_LOCAL="$TMPROOT/setup-keys-local.sh"
sed "s|/home/audrey/blob-app/.env.vps|${FAKE_LOCAL_ENV}|g" \
  "$SCRIPT_DIR/setup-backup-keys.sh" > "$PATCHED_LOCAL"
chmod +x "$PATCHED_LOCAL"

if bash "$PATCHED_LOCAL" 2>&1 | grep -q 'ERREUR DE SÉCURITÉ'; then
  log_fail "setup-backup-keys.sh refuse à tort en env local"
else
  log_pass "setup-backup-keys.sh accepte en env local (non-VPS)"
fi

# ══════════════════════════════════════════════════════════════════════════════
log_test 11 "Aucun secret sensible dans les logs d'upload"
# ══════════════════════════════════════════════════════════════════════════════
BD11="$(make_backup_dir t11)"
make_backup_file "$BD11" "blobsurf_2026-05-13_110000.sql.gz" 128 > /dev/null

# Injecter de faux secrets dans l'env pour vérifier qu'ils ne leakent pas
LOG11="$TMPROOT/t11.log"
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/SUPERSECRET_WEBHOOK/SECRET_KEY_789" \
  ENV_FILE="$BASE_ENV" \
  BACKUP_DIR="$BD11" \
  RCLONE_REMOTE=r2-test \
  R2_BUCKET=test-bucket \
  UPLOAD_WINDOW_HOURS=9999 \
  bash "$SCRIPT_DIR/backup-encrypt-upload.sh" > "$LOG11" 2>&1 || true

LEAKED=false
for secret in "SUPERSECRET_WEBHOOK" "SECRET_KEY_789" "AGE-SECRET-KEY"; do
  if grep -q "$secret" "$LOG11"; then
    log_fail "Secret '$secret' trouvé dans les logs d'upload"
    LEAKED=true
  fi
done
$LEAKED || log_pass "Aucun secret sensible dans les logs d'upload"

# ══════════════════════════════════════════════════════════════════════════════
log_test 12 "Ordre opérations : .r2 posé EN DERNIER (après upload + vérif + manifest)"
# ══════════════════════════════════════════════════════════════════════════════
# Vérification statique dans le code source — utilise les commentaires d'étapes uniques
# pour localiser les sections sans dépendre du formatage multi-lignes des appels rclone.

UPLOAD_ENCRYPT="$SCRIPT_DIR/backup-encrypt-upload.sh"

# Les commentaires de pas sont uniques et sur une seule ligne
L_UPLOAD=$(grep -n '3/5 Upload R2' "$UPLOAD_ENCRYPT" | head -1 | cut -d: -f1)
L_VERIF=$(grep -n '4/5 Vérification' "$UPLOAD_ENCRYPT" | head -1 | cut -d: -f1)
L_MANIFEST=$(grep -n '5/5 Upload SHA256' "$UPLOAD_ENCRYPT" | head -1 | cut -d: -f1)
L_R2=$(grep -n 'touch.*\.r2' "$UPLOAD_ENCRYPT" | head -1 | cut -d: -f1)

vlog "Lignes : upload(3/5)=$L_UPLOAD vérif(4/5)=$L_VERIF manifest(5/5)=$L_MANIFEST .r2=$L_R2"

if [[ -n "$L_UPLOAD" && -n "$L_VERIF" && -n "$L_MANIFEST" && -n "$L_R2" ]]; then
  if (( L_UPLOAD < L_VERIF && L_VERIF < L_MANIFEST && L_MANIFEST < L_R2 )); then
    log_pass "Ordre correct : upload(L$L_UPLOAD) < vérif(L$L_VERIF) < manifest(L$L_MANIFEST) < .r2(L$L_R2)"
  else
    log_fail "Ordre incorrect : upload=$L_UPLOAD vérif=$L_VERIF manifest=$L_MANIFEST .r2=$L_R2"
  fi
else
  log_fail "Impossible de localiser une ou plusieurs étapes — lignes: upload=$L_UPLOAD vérif=$L_VERIF manifest=$L_MANIFEST .r2=$L_R2"
fi

# ══════════════════════════════════════════════════════════════════════════════
printf '\n'
printf '════════════════════════════════════════════════════════════════\n'
if (( FAIL == 0 )); then
  green "  ✅ RÉSULTATS : ${PASS} PASS, 0 FAIL"
  green "  SAFE TO MERGE — toutes les propriétés critiques prouvées"
else
  red   "  ❌ RÉSULTATS : ${PASS} PASS, ${FAIL} FAIL"
  red   "  NOT SAFE TO MERGE — corriger les FAIL avant merge"
fi
printf '════════════════════════════════════════════════════════════════\n'

(( FAIL == 0 ))
