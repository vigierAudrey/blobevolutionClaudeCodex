#!/usr/bin/env bash
# smoke-test-vps.sh — Qualification GO/NO-GO de l'environnement VPS Runtime
#
# 16 checks fonctionnels (identiques au smoke-test.sh pré-VPS)
# + 4 checks S3 réels (preuve flux stockage VPS)
#
# [17] Storage domain joignable via nginx HTTPS
# [18] Presigned PUT URL générée sans localhost
# [19] Upload réel d'un fichier via presigned URL
# [20] Lecture du fichier uploadé via URL publique
#
# Exit 0 = GO, exit 1 = NO-GO.
#
# Prérequis : curl, jq
# Usage    : ./scripts/smoke-test-vps.sh
#            API_BASE_URL=https://api.blobinfini.fr ./scripts/smoke-test-vps.sh

set -uo pipefail

API="${API_BASE_URL:-https://api.blobinfini.local}"
WEB="${WEB_BASE_URL:-https://app.blobinfini.local}"
STORAGE="${STORAGE_BASE_URL:-https://storage.blobinfini.local}"

RIDER_A_EMAIL="rider.a@pre-vps.blobinfini.local"
RIDER_A_PASS="RiderAlpha2026!PreVPS"
RIDER_A_UUID="11111111-1111-4111-a111-111111111111"

RIDER_B_EMAIL="rider.b@pre-vps.blobinfini.local"
RIDER_B_PASS="RiderBeta2026!PreVPS"
RIDER_B_UUID="22222222-2222-4222-b222-222222222222"

PASS=0
FAIL=0

# ─── Helpers ─────────────────────────────────────────────────────────────────
check() {
  local name="$1" result="$2" expected="$3"
  if [ "$result" = "$expected" ]; then
    printf "  \033[32mOK\033[0m   %s\n" "$name"
    PASS=$((PASS + 1))
  else
    printf "  \033[31mFAIL\033[0m %s  (attendu: '%s'  obtenu: '%s')\n" "$name" "$expected" "$result"
    FAIL=$((FAIL + 1))
  fi
}

check_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q "$needle" 2>/dev/null; then
    printf "  \033[32mOK\033[0m   %s\n" "$name"
    PASS=$((PASS + 1))
  else
    printf "  \033[31mFAIL\033[0m %s  (attendu contenir: '%s')\n" "$name" "$needle"
    printf "       Début réponse: %s\n" "$(echo "$haystack" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

check_not_contains() {
  local name="$1" haystack="$2" needle="$3"
  if ! echo "$haystack" | grep -q "$needle" 2>/dev/null; then
    printf "  \033[32mOK\033[0m   %s\n" "$name"
    PASS=$((PASS + 1))
  else
    printf "  \033[31mFAIL\033[0m %s  (ne doit PAS contenir: '%s')\n" "$name" "$needle"
    FAIL=$((FAIL + 1))
  fi
}

# shellcheck disable=SC2086
http_status() {
  curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" "$@"
}

# shellcheck disable=SC2086
http_body() {
  curl -sk $CURL_RESOLVE "$@"
}

acquire_csrf() {
  local jar="$1"
  # shellcheck disable=SC2086
  curl -sk $CURL_RESOLVE -c "$jar" -b "$jar" \
    -H "Origin: https://app.blobinfini.local" \
    "$API/csrf-token" \
    | jq -r '.csrfToken // empty' 2>/dev/null || echo ""
}

echo "=== Smoke test VPS Runtime BlobConnect ==="
printf "    API     : %s\n" "$API"
printf "    Web     : %s\n" "$WEB"
printf "    Storage : %s\n\n" "$STORAGE"

# Auto-détection DNS
CURL_RESOLVE=""
if ! getent hosts api.blobinfini.local >/dev/null 2>&1; then
  echo "  INFO: domaines absents de /etc/hosts — utilisation de --resolve (curl)"
  CURL_RESOLVE="--resolve api.blobinfini.local:443:127.0.0.1 --resolve api.blobinfini.local:80:127.0.0.1 --resolve app.blobinfini.local:443:127.0.0.1 --resolve app.blobinfini.local:80:127.0.0.1 --resolve storage.blobinfini.local:443:127.0.0.1 --resolve storage.blobinfini.local:80:127.0.0.1"
fi

COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
COOKIE_RL=$(mktemp)
HEADERS_A=$(mktemp)
trap 'rm -f "$COOKIE_A" "$COOKIE_B" "$COOKIE_RL" "$HEADERS_A"' EXIT

# ─── [1] API liveness ─────────────────────────────────────────────────────────
echo "--- [1] API liveness ---"
S=$(http_status "$API/health")
check "GET /health → 200" "$S" "200"

# ─── [2] API security health ──────────────────────────────────────────────────
echo "--- [2] API security health ---"
if [ -z "${SECURITY_MONITOR_TOKEN:-}" ] && [ -f ".env.vps" ]; then
  SECURITY_MONITOR_TOKEN=$(grep -E '^SECURITY_MONITOR_TOKEN=' .env.vps \
    | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d ' ')
fi

if [ -z "${SECURITY_MONITOR_TOKEN:-}" ]; then
  printf "  \033[31mFAIL\033[0m SECURITY_MONITOR_TOKEN absent\n"
  FAIL=$((FAIL + 1))
else
  B=$(http_body -H "X-Security-Monitor-Token: $SECURITY_MONITOR_TOKEN" "$API/security/health")
  HEALTH_STATUS=$(echo "$B" | jq -r '.status // "MISSING"' 2>/dev/null || echo "MISSING")
  check "GET /security/health status = SECURE" "$HEALTH_STATUS" "SECURE"
fi

# ─── [3] Frontend liveness ────────────────────────────────────────────────────
echo "--- [3] Frontend liveness ---"
S=$(http_status "$WEB")
check "GET web / → pas 5xx" "$([ "$S" -lt 500 ] 2>/dev/null && echo ok || echo fail)" "ok"

# ─── [4] Redis actif ──────────────────────────────────────────────────────────
echo "--- [4] Redis actif ---"
if command -v docker >/dev/null 2>&1; then
  REDIS_PONG=$(docker compose -f docker-compose.vps.yml exec -T redis \
    redis-cli -a "${REDIS_PASSWORD:-}" ping 2>/dev/null | tr -d '\r\n' || echo "")
  check "Redis répond PONG" "$REDIS_PONG" "PONG"
else
  echo "  SKIP Redis ping (docker absent)"
fi

# ─── [5] HTTPS + cookie Secure ────────────────────────────────────────────────
echo "--- [5] HTTPS opérationnel ---"
S=$(http_status -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.blobinfini.local" \
  -d '{"email":"smoke@test.invalid","password":"wrong"}')
check "POST /auth/login via HTTPS répond (non 000)" \
  "$([ "$S" != "000" ] && echo ok || echo fail)" "ok"

# ─── [6] CORS hostile rejeté ──────────────────────────────────────────────────
echo "--- [6] CORS hostile rejeté ---"
S=$(http_status \
  -H "Origin: https://attacker.example" \
  -X OPTIONS "$API/auth/login")
check "OPTIONS avec Origin hostile → 403" "$S" "403"

# ─── [7] Auth rider A ─────────────────────────────────────────────────────────
echo "--- [7] Auth rider A ---"
CSRF_A=$(acquire_csrf "$COOKIE_A")
# shellcheck disable=SC2086
LOGIN_A=$(curl -sk $CURL_RESOLVE \
  -c "$COOKIE_A" -b "$COOKIE_A" \
  -D "$HEADERS_A" \
  -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.blobinfini.local" \
  -H "X-CSRF-Token: $CSRF_A" \
  -d "{\"email\":\"$RIDER_A_EMAIL\",\"password\":\"$RIDER_A_PASS\"}")
LOGIN_A_STATUS=$(grep "^HTTP" "$HEADERS_A" | tail -1 | awk '{print $2}' | tr -d '\r')
check "POST /auth/login rider A → 200" "$LOGIN_A_STATUS" "200"
check_contains "Réponse login A = ok" "$LOGIN_A" '"ok"'
COOKIE_SECURE=$(grep -i "set-cookie" "$HEADERS_A" || true)
check_contains "Cookie Set-Cookie contient Secure" "$COOKIE_SECURE" "Secure"
CSRF_A_POST=$(acquire_csrf "$COOKIE_A")

# ─── [8] Auth rider B ─────────────────────────────────────────────────────────
echo "--- [8] Auth rider B ---"
CSRF_B=$(acquire_csrf "$COOKIE_B")
# shellcheck disable=SC2086
LOGIN_B_STATUS=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
  -c "$COOKIE_B" -b "$COOKIE_B" \
  -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.blobinfini.local" \
  -H "X-CSRF-Token: $CSRF_B" \
  -d "{\"email\":\"$RIDER_B_EMAIL\",\"password\":\"$RIDER_B_PASS\"}")
check "POST /auth/login rider B → 200" "$LOGIN_B_STATUS" "200"
CSRF_B_POST=$(acquire_csrf "$COOKIE_B")

# ─── [9] Profil rider A ───────────────────────────────────────────────────────
echo "--- [9] Profil rider A ---"
PROFILE_A_STATUS=$(http_status -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  "$API/profile/me")
check "GET /profile/me rider A → 200" "$PROFILE_A_STATUS" "200"
PROFILE_A=$(http_body -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  "$API/profile/me")
check_contains "Profil A contient UUID connu" "$PROFILE_A" "$RIDER_A_UUID"

# ─── [10] Profil rider B ──────────────────────────────────────────────────────
echo "--- [10] Profil rider B ---"
PROFILE_B_STATUS=$(http_status -b "$COOKIE_B" \
  -H "Origin: https://app.blobinfini.local" \
  "$API/profile/me")
check "GET /profile/me rider B → 200" "$PROFILE_B_STATUS" "200"

# ─── [11] Matching POST ───────────────────────────────────────────────────────
echo "--- [11] Matching POST rider A ---"
MATCHING_STATUS=$(http_status \
  -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
  -X POST "$API/matching/search" \
  -d '{"sport":"surf","level":"intermediate","date":"anytime","location":{"lat":43.4832,"lng":-1.5586},"distanceKm":100}')
check "POST /matching/search → 200" "$MATCHING_STATUS" "200"
MATCHING=$(http_body \
  -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
  -X POST "$API/matching/search" \
  -d '{"sport":"surf","level":"intermediate","date":"anytime","location":{"lat":43.4832,"lng":-1.5586},"distanceKm":100}')
MATCHING_RESULTS=$(echo "$MATCHING" | jq '.results // []' 2>/dev/null || echo "[]")
check_not_contains "Résultats matching sans lat brut" "$MATCHING_RESULTS" '"lat":'
check_not_contains "Résultats matching sans lng brut" "$MATCHING_RESULTS" '"lng":'
check_contains     "Matching contient results[]" "$MATCHING" '"results"'

# ─── [12] Ouverture conversation ──────────────────────────────────────────────
echo "--- [12] Ouverture conversation A → B ---"
# shellcheck disable=SC2086
CONV_STATUS=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
  -c "$COOKIE_A" -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
  -X POST "$API/conversations/open" \
  -d "{\"targetUserId\":\"$RIDER_B_UUID\"}")
check "POST /conversations/open → 200 ou 201" \
  "$([ "$CONV_STATUS" = "200" ] || [ "$CONV_STATUS" = "201" ] && echo ok || echo fail)" "ok"
# shellcheck disable=SC2086
CONV_BODY=$(curl -sk $CURL_RESOLVE \
  -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
  -X POST "$API/conversations/open" \
  -d "{\"targetUserId\":\"$RIDER_B_UUID\"}")
CONV_ID=$(echo "$CONV_BODY" | jq -r '.id // empty' 2>/dev/null || echo "")

# ─── [13] Envoi message ───────────────────────────────────────────────────────
echo "--- [13] Envoi message dans conversation ---"
if [ -n "$CONV_ID" ]; then
  # shellcheck disable=SC2086
  MSG_STATUS=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
    -b "$COOKIE_A" \
    -H "Origin: https://app.blobinfini.local" \
    -H "Content-Type: application/json" \
    -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
    -X POST "$API/conversations/$CONV_ID/messages" \
    -d '{"content":"smoke test vps"}')
  check "POST /conversations/:id/messages → 200 ou 201" \
    "$([ "$MSG_STATUS" = "200" ] || [ "$MSG_STATUS" = "201" ] && echo ok || echo fail)" "ok"
else
  echo "  FAIL [13] conversationId absent — check [12] a échoué"
  FAIL=$((FAIL + 1))
fi

# ─── [14] CSRF : POST sans token → 403 ────────────────────────────────────────
echo "--- [14] CSRF protection ---"
# shellcheck disable=SC2086
CSRF_STATUS=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
  -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  -H "Content-Type: application/json" \
  -X POST "$API/conversations/open" \
  -d "{\"targetUserId\":\"$RIDER_B_UUID\"}")
check "POST sans X-CSRF-Token → 403" "$CSRF_STATUS" "403"

# ─── [15] Rate-limit login → 429 ──────────────────────────────────────────────
echo "--- [15] Rate-limit login → 429 ---"
CSRF_RL=$(acquire_csrf "$COOKIE_RL")
GOT_429=false
for i in 1 2 3 4 5 6 7; do
  # shellcheck disable=SC2086
  S=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
    -c "$COOKIE_RL" -b "$COOKIE_RL" \
    -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -H "Origin: https://app.blobinfini.local" \
    -H "X-CSRF-Token: $CSRF_RL" \
    -d '{"email":"ratelimit-smoke-vps@test.invalid","password":"wrong"}')
  if [ "$S" = "429" ]; then
    GOT_429=true
    echo "       429 obtenu à la tentative $i"
    break
  fi
  if [ "$S" = "403" ]; then
    CSRF_RL=$(acquire_csrf "$COOKIE_RL")
  fi
done
check "Tentatives répétées login → 429" "$GOT_429" "true"

# ─── [16] Prisma migrate status ───────────────────────────────────────────────
echo "--- [16] DB : 0 migrations en attente ---"
if command -v docker >/dev/null 2>&1; then
  MIGRATE_STATUS=$(docker compose -f docker-compose.vps.yml run --rm \
    -e DATABASE_URL="postgresql://${POSTGRES_USER:-blobinfini_vps}:${POSTGRES_PASSWORD:-}@postgres:5432/${POSTGRES_DB:-blobinfini_vps}" \
    api \
    sh -c "cd /workspace && pnpm --filter @blobinfini/database exec prisma migrate status 2>&1" \
    2>/dev/null || echo "ERROR")
  check_contains "prisma migrate status → up to date" \
    "$MIGRATE_STATUS" "Database schema is up to date"
else
  echo "  SKIP migrate status (docker absent)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# CHECKS S3 VPS — PREUVE BOUT EN BOUT DU FLUX STOCKAGE
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "=== Checks S3 VPS (preuve flux stockage) ==="

# Charger env si disponible
if [ -f ".env.vps" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.vps"
  set +a
fi

S3_BUCKET_CHECK="${S3_BUCKET:-blobinfini-vps}"
STORAGE_DOMAIN_CHECK="${STORAGE_DOMAIN:-storage.blobinfini.local}"
SMOKE_KEY="smoke-test-vps/$(date +%s)-test.txt"
SMOKE_CONTENT="smoke-test-vps-$(date +%s)"

# ─── [17] Storage domain joignable via nginx HTTPS ────────────────────────────
echo "--- [17] Storage domain via nginx HTTPS ---"
# MinIO health endpoint est accessible publiquement (pas de policy sur /minio/health/live)
STORAGE_S=$(http_status "$STORAGE/minio/health/live")
check "GET $STORAGE/minio/health/live → 200" "$STORAGE_S" "200"

# ─── [18] Presigned PUT URL sans localhost ─────────────────────────────────────
echo "--- [18] Presigned PUT URL — pas de localhost ---"
# Acquérir une URL présignée via l'API (endpoint upload avatar — ou endpoint générique si disponible)
# On utilise le endpoint de presign d'avatar (si disponible) ou on teste directement via AWS SDK.
# Ici on teste via l'API /profile/upload-avatar qui retourne une presigned URL.
# shellcheck disable=SC2086
PRESIGN_RESP=$(curl -sk $CURL_RESOLVE \
  -b "$COOKIE_A" \
  -H "Origin: https://app.blobinfini.local" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
  -X POST "$API/profile/photo/upload-url" \
  -d '{"contentType":"image/png"}' 2>/dev/null || echo "{}")

PRESIGN_URL=$(echo "$PRESIGN_RESP" | jq -r '.url // .presignedUrl // .uploadUrl // empty' 2>/dev/null || echo "")

if [ -n "$PRESIGN_URL" ]; then
  check_not_contains "Presigned URL sans 'localhost'" "$PRESIGN_URL" "localhost"
  check_not_contains "Presigned URL sans '127.0.0.1'" "$PRESIGN_URL" "127.0.0.1"
  check_not_contains "Presigned URL sans 'minio:'" "$PRESIGN_URL" "minio:"
  check_contains     "Presigned URL contient storage domain" "$PRESIGN_URL" "$STORAGE_DOMAIN_CHECK"
  check_contains     "Presigned URL https://" "$PRESIGN_URL" "https://"
  echo "       URL: $(echo "$PRESIGN_URL" | head -c 100)..."
else
  printf "  \033[31mFAIL\033[0m [18] /profile/photo/upload-url n'a pas retourné de presigned URL\n"
  echo "       Réponse brute: $(echo "$PRESIGN_RESP" | head -c 300)"
  echo "       Cause probable : 2FA requis (AUTH_REQUIRE_2FA=true) mais session smoke-test non complétée."
  echo "       Les checks [18][19][20] sont INVALIDES sans presigned URL réelle via l'API."
  FAIL=$((FAIL + 1))
fi

# ─── [19] Upload réel via presigned URL ────────────────────────────────────────
echo "--- [19] Upload réel via presigned URL ---"
if [ -n "$PRESIGN_URL" ]; then
  # Upload via presigned PUT URL — ce test doit passer par nginx, pas par mc (sinon aucune valeur probante)
  UPLOAD_STATUS=$(curl -sk \
    $CURL_RESOLVE \
    -X PUT "$PRESIGN_URL" \
    -H "Content-Type: image/png" \
    --data-binary "PNG-SMOKE-VPS-TEST" \
    -o /dev/null \
    -w "%{http_code}" 2>/dev/null || echo "000")
  check "PUT presigned URL → 200" "$([ "$UPLOAD_STATUS" = "200" ] && echo ok || echo fail)" "ok"
  if [ "$UPLOAD_STATUS" != "200" ]; then
    echo "       HTTP status upload: $UPLOAD_STATUS"
    echo "       Si 403/SignatureDoesNotMatch : vérifier MINIO_SERVER_URL == S3_PRESIGN_ENDPOINT"
    echo "       Si 000 : vérifier résolution DNS / certs TLS du storage domain"
  fi
else
  # Pas de fallback mc : le test mc bypasse nginx et CORS, ce qui masque les vrais problèmes
  printf "  \033[31mFAIL\033[0m [19] SKIP — presigned URL absente, test sans valeur probante\n"
  FAIL=$((FAIL + 1))
fi

# ─── [20] Lecture via URL publique (GET anonyme) ──────────────────────────────
echo "--- [20] Lecture via URL publique ---"
if [ -n "$PRESIGN_URL" ] && [ "$UPLOAD_STATUS" = "200" ]; then
  # Extraire la clé depuis la presigned URL (path après le bucket)
  PRESIGN_PATH=$(echo "$PRESIGN_URL" | sed 's/?.*//' | sed "s|.*/${S3_BUCKET_CHECK}/||")
  PUBLIC_READ_URL="${STORAGE}/${S3_BUCKET_CHECK}/${PRESIGN_PATH}"

  READ_STATUS=$(curl -sk \
    $CURL_RESOLVE \
    -o /dev/null \
    -w "%{http_code}" \
    "$PUBLIC_READ_URL" 2>/dev/null || echo "000")
  check "GET URL publique → 200 (bucket GET-only anonyme)" \
    "$([ "$READ_STATUS" = "200" ] && echo ok || echo fail)" "ok"
  if [ "$READ_STATUS" != "200" ]; then
    echo "       URL testée: $PUBLIC_READ_URL"
    echo "       HTTP status: $READ_STATUS"
    echo "       Si 403 : vérifier mc anonymous set download sur le bucket"
  fi

  # Test négatif : listing du bucket doit être interdit
  LIST_STATUS=$(curl -sk \
    $CURL_RESOLVE \
    -o /dev/null \
    -w "%{http_code}" \
    "${STORAGE}/${S3_BUCKET_CHECK}/" 2>/dev/null || echo "000")
  check "GET bucket listing → 403 (listing interdit)" \
    "$([ "$LIST_STATUS" = "403" ] && echo ok || echo fail)" "ok"
  if [ "$LIST_STATUS" != "403" ]; then
    echo "       WARN: listing bucket retourne HTTP $LIST_STATUS (attendu: 403)"
  fi
else
  printf "  \033[31mFAIL\033[0m [20] SKIP — upload [19] absent ou échoué, test de lecture sans valeur probante\n"
  FAIL=$((FAIL + 1))
fi

# ─── Résumé final ─────────────────────────────────────────────────────────────
echo ""
echo "======================================"
TOTAL=$((PASS + FAIL))
printf "  Résultat : %d/%d checks passés\n" "$PASS" "$TOTAL"
printf "  Fonctionnel : 1-16 | S3 VPS proof : 17-20\n"
if [ "$FAIL" -eq 0 ]; then
  printf "  \033[32mVERDICT : GO VPS ✓\033[0m\n"
  echo "======================================"
  exit 0
else
  printf "  \033[31mVERDICT : NO-GO (%d échec(s))\033[0m\n" "$FAIL"
  echo "======================================"
  exit 1
fi
