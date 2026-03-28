#!/usr/bin/env bash
# smoke-test.sh — Qualification GO/NO-GO de l'environnement pré-VPS
#
# 16 checks séquentiels, cumulatifs (ne s'arrête pas au premier échec).
# Exit 0 = GO, exit 1 = NO-GO.
#
# Prérequis : curl, jq
# Usage    : ./scripts/smoke-test.sh
#            API_BASE_URL=https://api.blobinfini.local ./scripts/smoke-test.sh

set -uo pipefail

# ─── Garde anti-production ────────────────────────────────────────────────────
if [ "${NODE_ENV:-}" = "production" ] && [ "${APP_ENV:-}" != "pre-vps" ]; then
  echo "ABORT: smoke-test.sh ne doit pas s'exécuter contre la production." >&2
  exit 1
fi

API="${API_BASE_URL:-https://api.blobinfini.local}"
WEB="${WEB_BASE_URL:-https://app.blobinfini.local}"

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

# curl silencieux, TLS skip (mkcert self-signed), retourne status HTTP
# shellcheck disable=SC2086
http_status() {
  curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" "$@"
}

# curl silencieux, retourne le body
# shellcheck disable=SC2086
http_body() {
  curl -sk $CURL_RESOLVE "$@"
}

# Acquiert un CSRF token via GET /csrf-token en utilisant/mettant à jour le cookie jar fourni
# Usage: acquire_csrf <cookie_jar_path>
# Retourne: le token CSRF (ou chaîne vide si échec)
acquire_csrf() {
  local jar="$1"
  # shellcheck disable=SC2086
  curl -sk $CURL_RESOLVE -c "$jar" -b "$jar" \
    -H "Origin: https://app.blobinfini.local" \
    "$API/csrf-token" \
    | jq -r '.csrfToken // empty' 2>/dev/null || echo ""
}

echo "=== Smoke test pré-VPS BlobConnect ==="
printf "    API : %s\n" "$API"
printf "    Web : %s\n\n" "$WEB"

# Auto-détection DNS : si les domaines sont absents de /etc/hosts, utiliser --resolve
# Permet de lancer le smoke test sans sudo (curl --resolve bypass DNS system)
CURL_RESOLVE=""
if ! getent hosts api.blobinfini.local >/dev/null 2>&1; then
  echo "  INFO: api.blobinfini.local absent de /etc/hosts — utilisation de --resolve (curl)"
  CURL_RESOLVE="--resolve api.blobinfini.local:443:127.0.0.1 --resolve api.blobinfini.local:80:127.0.0.1 --resolve app.blobinfini.local:443:127.0.0.1 --resolve app.blobinfini.local:80:127.0.0.1"
fi

COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
COOKIE_RL=$(mktemp)   # Rate-limit test cookie jar
trap 'rm -f "$COOKIE_A" "$COOKIE_B" "$COOKIE_RL"' EXIT

# ─── [1] API liveness ─────────────────────────────────────────────────────────
echo "--- [1] API liveness ---"
S=$(http_status "$API/health")
check "GET /health → 200" "$S" "200"

# ─── [2] API security health ──────────────────────────────────────────────────
echo "--- [2] API security health ---"
if [ -n "${METRICS_INTERNAL_TOKEN:-}" ]; then
  B=$(http_body -H "X-Internal-Token: $METRICS_INTERNAL_TOKEN" "$API/security/health")
  check_contains "GET /security/health contient status" "$B" '"status"'
else
  echo "  SKIP /security/health (METRICS_INTERNAL_TOKEN absent)"
fi

# ─── [3] Frontend liveness ────────────────────────────────────────────────────
echo "--- [3] Frontend liveness ---"
S=$(http_status "$WEB")
check "GET web / → pas 5xx" "$([ "$S" -lt 500 ] 2>/dev/null && echo ok || echo fail)" "ok"

# ─── [4] Redis actif ──────────────────────────────────────────────────────────
echo "--- [4] Redis actif ---"
if [ -n "${METRICS_INTERNAL_TOKEN:-}" ]; then
  B=$(http_body -H "X-Internal-Token: $METRICS_INTERNAL_TOKEN" "$API/internal/metrics")
  REDIS_OK=$(echo "$B" | jq -r '.redis.connected // false' 2>/dev/null || echo "false")
  check "Redis connected=true dans /internal/metrics" "$REDIS_OK" "true"
else
  echo "  SKIP Redis check (METRICS_INTERNAL_TOKEN absent)"
fi

# ─── [5] HTTPS + cookie Secure ────────────────────────────────────────────────
echo "--- [5] HTTPS opérationnel ---"
S=$(http_status -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.blobinfini.local" \
  -d '{"email":"smoke@test.invalid","password":"wrong"}')
# 401/403 = endpoint atteint via HTTPS (CSRF ou auth fail), pas erreur réseau (000)
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
# Étape 1: acquérir CSRF token (GET établit la session avec csrfSecret)
CSRF_A=$(acquire_csrf "$COOKIE_A")
if [ -z "$CSRF_A" ]; then
  echo "  WARN: impossible d'acquérir CSRF token A"
fi

# Étape 2: login avec cookie session + CSRF token
# shellcheck disable=SC2086
LOGIN_A=$(curl -sk $CURL_RESOLVE \
  -c "$COOKIE_A" -b "$COOKIE_A" \
  -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.blobinfini.local" \
  -H "X-CSRF-Token: $CSRF_A" \
  -d "{\"email\":\"$RIDER_A_EMAIL\",\"password\":\"$RIDER_A_PASS\"}")

# shellcheck disable=SC2086
LOGIN_A_STATUS=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
  -b "$COOKIE_A" \
  -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.blobinfini.local" \
  -H "X-CSRF-Token: $CSRF_A" \
  -d "{\"email\":\"$RIDER_A_EMAIL\",\"password\":\"$RIDER_A_PASS\"}")
check "POST /auth/login rider A → 200" "$LOGIN_A_STATUS" "200"
check_contains "Réponse login A = ok" "$LOGIN_A" '"ok"'

# Cookie Secure : vérifier via les headers en mode verbose
# shellcheck disable=SC2086
COOKIE_SECURE=$(curl -sk $CURL_RESOLVE -v \
  -b "$COOKIE_A" \
  -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.blobinfini.local" \
  -H "X-CSRF-Token: $CSRF_A" \
  -d "{\"email\":\"$RIDER_A_EMAIL\",\"password\":\"$RIDER_A_PASS\"}" 2>&1 | { grep -i "set-cookie" || true; } | head -3)
check_contains "Cookie Set-Cookie contient Secure" "$COOKIE_SECURE" "Secure"

# Étape 3: acquérir CSRF post-login (session régénérée mais secret préservé)
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

# Geo privacy : lat/lng des profils pas exposés dans les résultats
check_not_contains "Matching résultats sans lat brut" "$MATCHING" '"lat":'
check_not_contains "Matching résultats sans lng brut" "$MATCHING" '"lng":'
check_contains     "Matching contient results[]" "$MATCHING" '"results"'

# ─── [12] Ouverture conversation ──────────────────────────────────────────────
echo "--- [12] Ouverture conversation A → B ---"
# Route : POST /conversations/open (conversations montées sur /conversations dans index.ts)
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
# Réponse : { id: "...", created?: boolean }
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
    -d '{"content":"smoke test pre-vps"}')
  check "POST /conversations/:id/messages → 200 ou 201" \
    "$([ "$MSG_STATUS" = "200" ] || [ "$MSG_STATUS" = "201" ] && echo ok || echo fail)" "ok"
else
  echo "  FAIL [13] conversationId absent — check [12] a échoué"
  FAIL=$((FAIL + 1))
fi

# ─── [14] CSRF : POST sans token → 403 ────────────────────────────────────────
echo "--- [14] CSRF protection ---"
# Tester avec cookie de session valide MAIS sans X-CSRF-Token
# Rider A a une session active — sans CSRF token, doit obtenir 403
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
# Acquérir un CSRF token pour le rate-limit test
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
    -d '{"email":"ratelimit-smoke-pvps@test.invalid","password":"wrong"}')
  if [ "$S" = "429" ]; then
    GOT_429=true
    echo "       429 obtenu à la tentative $i"
    break
  fi
  # Rafraîchir le CSRF token si nécessaire (le session peut expirer)
  if [ "$S" = "403" ]; then
    CSRF_RL=$(acquire_csrf "$COOKIE_RL")
  fi
done
check "Tentatives répétées login → 429" "$GOT_429" "true"

# ─── [16] Prisma migrate status : 0 migrations en attente ────────────────────
echo "--- [16] DB : 0 migrations en attente ---"
if command -v docker >/dev/null 2>&1; then
  MIGRATE_STATUS=$(docker compose -f docker-compose.pre-vps.yml run --rm \
    -e DATABASE_URL="postgresql://${POSTGRES_USER:-blobinfini_pvps}:${POSTGRES_PASSWORD:-}@postgres:5432/${POSTGRES_DB:-blobinfini_pvps}" \
    api \
    sh -c "cd /workspace && pnpm --filter @blobinfini/database exec prisma migrate status 2>&1" \
    2>/dev/null || echo "ERROR")
  check_contains "prisma migrate status → up to date" \
    "$MIGRATE_STATUS" "Database schema is up to date"
else
  echo "  SKIP migrate status (docker absent)"
fi

# ─── Résumé final ─────────────────────────────────────────────────────────────
echo ""
echo "======================================"
TOTAL=$((PASS + FAIL))
printf "  Résultat : %d/%d checks passés\n" "$PASS" "$TOTAL"
if [ "$FAIL" -eq 0 ]; then
  printf "  \033[32mVERDICT : GO ✓\033[0m\n"
  echo "======================================"
  exit 0
else
  printf "  \033[31mVERDICT : NO-GO (%d échec(s))\033[0m\n" "$FAIL"
  echo "======================================"
  exit 1
fi
