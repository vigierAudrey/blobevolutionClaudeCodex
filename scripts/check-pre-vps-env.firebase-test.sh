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
expect_absent() { # name output literal — le motif NE doit PAS apparaître
  if grep -qF "$3" <<<"$2"; then echo "  ✗ $1 — inattendu: $3"; FAIL=$((FAIL + 1));
  else echo "  ✓ $1"; PASS=$((PASS + 1)); fi
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

# 9. push ON + FIREBASE_PRIVATE_KEY présente mais pas une clé PEM → FAIL
mk "$F" 'FIREBASE_PRIVATE_KEY=pas-une-cle-pem-mais-assez-longue-pour-min-length-xxxxxxxxxx'
out="$(run_script "$F")"
echo "[cas 9] push ON + FIREBASE_PRIVATE_KEY non-PEM → FAIL"
expect_contains "INVALIDE PRIVATE_KEY" "$out" "INVALIDE  : FIREBASE_PRIVATE_KEY"
expect_no_secret_leak "pas de fuite" "$out"

# 10. push ON + NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key → FAIL
mk "$F" "NEXT_PUBLIC_FIREBASE_API_KEY=demo-api-key"; out="$(run_script "$F")"
echo "[cas 10] push ON + API_KEY demo → FAIL"
expect_contains "DEMO interdit API_KEY" "$out" "VALEUR DEMO INTERDITE: NEXT_PUBLIC_FIREBASE_API_KEY"

# 11. push ON + NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789 → FAIL
mk "$F" "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789"; out="$(run_script "$F")"
echo "[cas 11] push ON + SENDER_ID sentinelle 123456789 → FAIL"
expect_contains "DEMO interdit SENDER_ID" "$out" "VALEUR DEMO INTERDITE: NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"

# 12. push ON + NEXT_PUBLIC_FIREBASE_APP_ID = app id demo (contient 123456789) → FAIL
mk "$F" "NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef123456"; out="$(run_script "$F")"
echo "[cas 12] push ON + APP_ID demo → FAIL"
expect_contains "DEMO interdit APP_ID" "$out" "VALEUR DEMO INTERDITE: NEXT_PUBLIC_FIREBASE_APP_ID"

# 13. push ON + NEXT_PUBLIC_FIREBASE_PROJECT_ID absent → FAIL (manquant)
mk "$F" "-NEXT_PUBLIC_FIREBASE_PROJECT_ID"; out="$(run_script "$F")"
echo "[cas 13] push ON + NEXT_PUBLIC_FIREBASE_PROJECT_ID absent → FAIL"
expect_contains "MANQUANT NEXT_PUBLIC_FIREBASE_PROJECT_ID" "$out" "MANQUANT  : NEXT_PUBLIC_FIREBASE_PROJECT_ID"

# 14. push OFF MAIS valeurs demo présentes → ne bloque PAS (push OFF prime)
mk "$F" "PUSH_NOTIFICATIONS_ENABLED=false" "FIREBASE_PROJECT_ID=blobinfini-demo" \
        "NEXT_PUBLIC_FIREBASE_VAPID_KEY=demo-vapid-key"
out="$(run_script "$F")"
echo "[cas 14] push OFF + valeurs demo présentes → OK (jamais de blocage push OFF)"
expect_contains "validation ignorée" "$out" "validation Firebase ignorée (push OFF, OK)"
expect_no_fb_error "aucune erreur Firebase" "$out"

# 15. push ON + clé PEM réaliste avec \n échappés → ACCEPTÉE (pas d'INVALIDE)
#     (le format .env.pre-vps réel : "-----BEGIN PRIVATE KEY-----\n...\n-----END...\n")
mk "$F"; out="$(run_script "$F")"
echo "[cas 15] push ON + clé PEM avec \\n échappés → ACCEPTÉE"
expect_absent "PRIVATE_KEY non rejetée" "$out" "INVALIDE  : FIREBASE_PRIVATE_KEY"

# Anti-fuite global : aucune valeur sensible factice ne doit JAMAIS apparaître,
# quel que soit le cas exécuté ci-dessus.
echo "[anti-fuite global]"
ALL=""
for case_env in \
  "-FIREBASE_PROJECT_ID" \
  "FIREBASE_PROJECT_ID=blobinfini-demo" \
  "-FIREBASE_CLIENT_EMAIL" \
  "-FIREBASE_PRIVATE_KEY" \
  'FIREBASE_PRIVATE_KEY=pas-une-cle-pem-mais-assez-longue-pour-min-length-xxxxxxxxxx' \
  "" ; do
  if [ -n "$case_env" ]; then mk "$F" "$case_env"; else mk "$F"; fi
  ALL+="$(run_script "$F")"$'\n'
done
expect_no_secret_leak "clé privée / email jamais affichés (tous cas)" "$ALL"

echo ""
echo "=== Résultat : $PASS OK / $FAIL échec(s) ==="
[ "$FAIL" -eq 0 ]
