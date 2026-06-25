#!/usr/bin/env bash
# Tests du garde-fou Firebase push de check-pre-vps-env.sh.
#
# Auto-suffisant (bash pur, aucune dépendance type bats). Exécute des cas avec des
# fichiers d'env temporaires et inspecte la SORTIE du script (les marqueurs d'erreur
# Firebase), sans dépendre du code retour global (les certs TLS / autres vars
# manquantes font échouer le script entier, ce qui est hors sujet ici).
#
# IMPORTANT : aucune vraie clé. Uniquement des placeholders factices évidents.
#
# Usage : bash scripts/check-pre-vps-env.firebase-test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/check-pre-vps-env.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
F="$WORK/env"

# Bloc Firebase « valide » de référence — valeurs FACTICES (pas de vrai secret).
valid_block() {
  cat <<'EOF'
PUSH_NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=blob-push-staging
FIREBASE_CLIENT_EMAIL=fcm-test@blob-push-staging.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEYFAKEKEY\n-----END PRIVATE KEY-----\n"
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaFakeStagingApiKey001
NEXT_PUBLIC_FIREBASE_PROJECT_ID=blob-push-staging
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=987654321098
NEXT_PUBLIC_FIREBASE_APP_ID=1:987654321098:web:fakestaging
NEXT_PUBLIC_FIREBASE_VAPID_KEY=BFakeVapidPublicStagingKey001
EOF
}

# mk "$file" [overrides...] : écrit le bloc valide dans "$file" puis applique des
# overrides. "KEY=VAL" remplace la ligne KEY ; "-KEY" supprime la ligne KEY.
mk() {
  local f="$1"; shift
  valid_block > "$f"
  local ov key
  for ov in "$@"; do
    if [[ "$ov" == -* ]]; then
      key="${ov#-}"
      grep -v "^${key}=" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
    else
      key="${ov%%=*}"
      grep -v "^${key}=" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
      printf '%s\n' "$ov" >> "$f"
    fi
  done
}

run_script() {
  # Environnement nettoyé : seules les valeurs du fichier comptent.
  env -u NODE_ENV -u APP_ENV -u PUSH_NOTIFICATIONS_ENABLED \
      -u FIREBASE_PROJECT_ID -u FIREBASE_CLIENT_EMAIL -u FIREBASE_PRIVATE_KEY \
      -u NEXT_PUBLIC_FIREBASE_API_KEY -u NEXT_PUBLIC_FIREBASE_PROJECT_ID \
      -u NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID -u NEXT_PUBLIC_FIREBASE_APP_ID \
      -u NEXT_PUBLIC_FIREBASE_VAPID_KEY \
      bash "$SCRIPT" "$1" 2>&1 || true
}

FB_ERROR_RE='MANQUANT  : (FIREBASE|NEXT_PUBLIC_FIREBASE)|TROP COURT: (FIREBASE|NEXT_PUBLIC_FIREBASE)|VALEUR DEMO INTERDITE|INVALIDE  : FIREBASE_PRIVATE_KEY|INCOHERENT: NEXT_PUBLIC_FIREBASE_PROJECT_ID'

expect_contains() { # name output literal
  if grep -qF "$3" <<<"$2"; then echo "  ✓ $1"; PASS=$((PASS + 1));
  else echo "  ✗ $1 — attendu: $3"; FAIL=$((FAIL + 1)); fi
}
expect_no_fb_error() { # name output
  if grep -qE "$FB_ERROR_RE" <<<"$2"; then
    echo "  ✗ $1 — erreur(s) Firebase inattendue(s)"; FAIL=$((FAIL + 1));
  else echo "  ✓ $1"; PASS=$((PASS + 1)); fi
}
expect_no_secret_leak() { # name output
  # La sortie ne doit JAMAIS contenir la clé privée factice ni l'email complet.
  if grep -qE "FAKEKEYFAKEKEY|fcm-test@blob-push-staging" <<<"$2"; then
    echo "  ✗ $1 — fuite de valeur sensible dans la sortie"; FAIL=$((FAIL + 1));
  else echo "  ✓ $1"; PASS=$((PASS + 1)); fi
}

echo "=== Tests garde-fou Firebase (check-pre-vps-env.sh) ==="

# 1. push OFF + Firebase absent → OK (ignoré, pas de blocage)
printf 'PUSH_NOTIFICATIONS_ENABLED=false\n' > "$F"
out="$(run_script "$F")"
echo "[cas 1] push OFF + Firebase absent → OK"
expect_contains "validation Firebase ignorée" "$out" "validation Firebase ignorée (push OFF, OK)"
expect_no_fb_error "aucune erreur Firebase" "$out"

# 2. push ON + FIREBASE_PROJECT_ID absent → FAIL
mk "$F" "-FIREBASE_PROJECT_ID"; out="$(run_script "$F")"
echo "[cas 2] push ON + FIREBASE_PROJECT_ID absent → FAIL"
expect_contains "MANQUANT FIREBASE_PROJECT_ID" "$out" "MANQUANT  : FIREBASE_PROJECT_ID"
expect_no_secret_leak "pas de fuite" "$out"

# 3. push ON + FIREBASE_PROJECT_ID=blobinfini-demo → FAIL
mk "$F" "FIREBASE_PROJECT_ID=blobinfini-demo"; out="$(run_script "$F")"
echo "[cas 3] push ON + FIREBASE_PROJECT_ID=blobinfini-demo → FAIL"
expect_contains "DEMO interdit FIREBASE_PROJECT_ID" "$out" "VALEUR DEMO INTERDITE: FIREBASE_PROJECT_ID"

# 4. push ON + FIREBASE_CLIENT_EMAIL absent → FAIL
mk "$F" "-FIREBASE_CLIENT_EMAIL"; out="$(run_script "$F")"
echo "[cas 4] push ON + FIREBASE_CLIENT_EMAIL absent → FAIL"
expect_contains "MANQUANT FIREBASE_CLIENT_EMAIL" "$out" "MANQUANT  : FIREBASE_CLIENT_EMAIL"

# 5. push ON + FIREBASE_PRIVATE_KEY absent → FAIL
mk "$F" "-FIREBASE_PRIVATE_KEY"; out="$(run_script "$F")"
echo "[cas 5] push ON + FIREBASE_PRIVATE_KEY absent → FAIL"
expect_contains "MANQUANT FIREBASE_PRIVATE_KEY" "$out" "MANQUANT  : FIREBASE_PRIVATE_KEY"

# 6. push ON + VAPID = demo-vapid-key → FAIL
mk "$F" "NEXT_PUBLIC_FIREBASE_VAPID_KEY=demo-vapid-key"; out="$(run_script "$F")"
echo "[cas 6] push ON + VAPID demo → FAIL"
expect_contains "DEMO interdit VAPID" "$out" "VALEUR DEMO INTERDITE: NEXT_PUBLIC_FIREBASE_VAPID_KEY"

# 7. push ON + NEXT_PUBLIC_FIREBASE_PROJECT_ID != FIREBASE_PROJECT_ID → FAIL
mk "$F" "NEXT_PUBLIC_FIREBASE_PROJECT_ID=autre-projet-front"; out="$(run_script "$F")"
echo "[cas 7] push ON + projets front/API divergents → FAIL"
expect_contains "INCOHERENT projet" "$out" "INCOHERENT: NEXT_PUBLIC_FIREBASE_PROJECT_ID"

# 8. push ON + valeurs plausibles test → OK (aucune erreur Firebase)
mk "$F"; out="$(run_script "$F")"
echo "[cas 8] push ON + config test plausible → OK"
expect_no_fb_error "aucune erreur Firebase" "$out"
expect_no_secret_leak "pas de fuite" "$out"

echo ""
echo "=== Résultat : $PASS OK / $FAIL échec(s) ==="
[ "$FAIL" -eq 0 ]
