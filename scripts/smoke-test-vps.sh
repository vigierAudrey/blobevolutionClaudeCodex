#!/usr/bin/env bash
# smoke-test-vps.sh — Qualification GO/NO-GO de l'environnement VPS Runtime
#
# 16 checks fonctionnels (identiques au smoke-test.sh pré-VPS)
# + 4 checks S3 réels (preuve flux stockage VPS)
#
# [17] Storage domain joignable via Caddy HTTPS (Let's Encrypt)
# [18] Presigned PUT URL générée sans localhost
# [19] Upload réel d'un fichier via presigned URL
# [20] Accès anonyme interdit sur l'objet users/* uploadé
#
# Exit 0 = GO, exit 1 = NO-GO.
#
# Prérequis : curl, jq
# Usage    : ./scripts/smoke-test-vps.sh
#            API_BASE_URL=https://api.blobsurf.com ./scripts/smoke-test-vps.sh

set -uo pipefail

# Charger .env.vps si présent (REDIS_PASSWORD, S3_BUCKET, STORAGE_DOMAIN, SECURITY_MONITOR_TOKEN...)
# Priorité aux variables déjà définies dans l'environnement hôte.
if [ -f ".env.vps" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.vps"
  set +a
fi

fail_config() {
  printf "  \033[31mFAIL\033[0m Configuration smoke VPS invalide: %s\n" "$*" >&2
  exit 1
}

first_csv_value() {
  printf "%s" "${1:-}" | cut -d',' -f1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

normalize_base_url() {
  local value="${1:-}"
  [ -n "$value" ] || return 1
  case "$value" in
    http://*|https://*) ;;
    *) value="https://${value}" ;;
  esac
  printf "%s" "${value%/}"
}

url_origin() {
  local value
  local scheme
  local rest
  value="$(normalize_base_url "${1:-}")" || return 1
  case "$value" in
    https://*)
      scheme="https"
      rest="${value#https://}"
      ;;
    http://*)
      scheme="http"
      rest="${value#http://}"
      ;;
  esac
  printf "%s://%s" "$scheme" "${rest%%/*}"
}

extract_host() {
  local value
  value="$(url_origin "${1:-}")" || return 1
  value="${value#https://}"
  value="${value#http://}"
  printf "%s" "${value%%:*}"
}

is_prod_smoke() {
  [ "${APP_ENV:-}" = "vps" ] && return 0
  [ "${NODE_ENV:-}" = "production" ] && return 0
  [ "${APP_DOMAIN:-}" = "blobsurf.com" ] && return 0
  return 1
}

assert_no_local_url() {
  local name="$1"
  local value="$2"
  if is_prod_smoke && printf "%s" "$value" | grep -Eq '(^|[/:.])localhost([/:]|$)|\.local([/:]|$)|127\.0\.0\.1|0\.0\.0\.0|::1'; then
    fail_config "$name ne doit pas utiliser un domaine local en production (valeur: $value)"
  fi
}

API_RAW="${API_BASE_URL:-}"
if [ -z "$API_RAW" ] && [ -n "${API_DOMAIN:-}" ]; then
  API_RAW="https://${API_DOMAIN}"
fi
[ -n "$API_RAW" ] || fail_config "API_BASE_URL absent et API_DOMAIN manquant"
API="$(normalize_base_url "$API_RAW")" || fail_config "API_BASE_URL/API_DOMAIN invalide"

WEB_RAW="${WEB_BASE_URL:-${FRONTEND_URL:-}}"
if [ -z "$WEB_RAW" ] && [ -n "${APP_DOMAIN:-}" ]; then
  WEB_RAW="https://${APP_DOMAIN}"
fi
[ -n "$WEB_RAW" ] || fail_config "WEB_BASE_URL/FRONTEND_URL absent et APP_DOMAIN manquant"
WEB="$(normalize_base_url "$WEB_RAW")" || fail_config "WEB_BASE_URL/FRONTEND_URL/APP_DOMAIN invalide"

STORAGE_RAW="${STORAGE_BASE_URL:-}"
if [ -z "$STORAGE_RAW" ] && [ -n "${S3_PUBLIC_URL_BASE:-}" ]; then
  STORAGE_RAW="$(url_origin "$S3_PUBLIC_URL_BASE")"
fi
if [ -z "$STORAGE_RAW" ] && [ -n "${STORAGE_DOMAIN:-}" ]; then
  STORAGE_RAW="https://${STORAGE_DOMAIN}"
fi
[ -n "$STORAGE_RAW" ] || fail_config "STORAGE_BASE_URL/S3_PUBLIC_URL_BASE absent et STORAGE_DOMAIN manquant"
STORAGE="$(url_origin "$STORAGE_RAW")" || fail_config "STORAGE_BASE_URL/S3_PUBLIC_URL_BASE/STORAGE_DOMAIN invalide"

SMOKE_ORIGIN_RAW="${SMOKE_ORIGIN:-${FRONTEND_URL:-}}"
if [ -z "$SMOKE_ORIGIN_RAW" ]; then
  SMOKE_ORIGIN_RAW="$(first_csv_value "${ALLOWED_ORIGINS:-${CORS_ORIGINS:-}}")"
fi
if [ -z "$SMOKE_ORIGIN_RAW" ]; then
  SMOKE_ORIGIN_RAW="$WEB"
fi
SMOKE_ORIGIN="$(url_origin "$SMOKE_ORIGIN_RAW")" || fail_config "Origin smoke invalide"

assert_no_local_url "API" "$API"
assert_no_local_url "WEB" "$WEB"
assert_no_local_url "STORAGE" "$STORAGE"
assert_no_local_url "SMOKE_ORIGIN" "$SMOKE_ORIGIN"
if is_prod_smoke && [ "${APP_DOMAIN:-}" = "blobsurf.com" ] && printf "%s" "$STORAGE" | grep -q "blobinfini.local"; then
  fail_config "STORAGE pointe vers blobinfini.local alors que APP_DOMAIN=blobsurf.com"
fi

RIDER_A_EMAIL="rider.a@pre-vps.blobinfini.local"
RIDER_A_PASS="RiderAlpha2026!PreVPS"
RIDER_A_UUID="11111111-1111-4111-a111-111111111111"

RIDER_B_EMAIL="rider.b@pre-vps.blobinfini.local"
RIDER_B_PASS="RiderBeta2026!PreVPS"
RIDER_B_UUID="22222222-2222-4222-b222-222222222222"

PASS=0
FAIL=0
SKIP=0
OPTIONAL_SKIP=0

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

echo "=== Smoke test VPS Runtime BlobConnect ==="
printf "    API     : %s\n" "$API"
printf "    Web     : %s\n" "$WEB"
printf "    Storage : %s\n" "$STORAGE"
printf "    Origin  : %s\n\n" "$SMOKE_ORIGIN"

# Auto-détection DNS locale pour les environnements *.local uniquement.
CURL_RESOLVE=""
add_local_resolve_if_needed() {
  local url="$1"
  local host
  host="$(extract_host "$url")" || return 0
  case "$host" in
    *.local)
      if ! getent hosts "$host" >/dev/null 2>&1; then
        CURL_RESOLVE="${CURL_RESOLVE:+$CURL_RESOLVE }--resolve ${host}:443:127.0.0.1 --resolve ${host}:80:127.0.0.1"
      fi
      ;;
  esac
}
add_local_resolve_if_needed "$API"
add_local_resolve_if_needed "$WEB"
add_local_resolve_if_needed "$STORAGE"
if [ -n "$CURL_RESOLVE" ]; then
  echo "  INFO: domaines *.local absents de /etc/hosts — utilisation de --resolve (curl)"
fi

# shellcheck disable=SC2086
http_status() {
  curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" "$@"
}

# shellcheck disable=SC2086
http_body() {
  curl -sk $CURL_RESOLVE "$@"
}

# shellcheck disable=SC2086
http_status_strict() {
  # Sans -k : valide le certificat TLS réel (jamais utilisé avec CURL_RESOLVE local)
  curl -s $CURL_RESOLVE -o /dev/null -w "%{http_code}" "$@"
}

wait_http_status() {
  local label="$1"
  local expected="$2"
  local attempts="$3"
  local delay="$4"
  shift 4
  local status="000"
  local i

  for i in $(seq 1 "$attempts"); do
    status="$(http_status "$@")"
    if [ "$status" = "$expected" ]; then
      printf "       %s → HTTP %s\n" "$label" "$status" >&2
      printf "%s" "$status"
      return 0
    fi
    printf "       %s tentative %s/%s → HTTP %s\n" "$label" "$i" "$attempts" "$status" >&2
    sleep "$delay"
  done

  printf "%s" "$status"
}

acquire_csrf() {
  local jar="$1"
  # shellcheck disable=SC2086
  curl -sk $CURL_RESOLVE -c "$jar" -b "$jar" \
    -H "Origin: $SMOKE_ORIGIN" \
    "$API/csrf-token" \
    | jq -r '.csrfToken // empty' 2>/dev/null || echo ""
}

COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
COOKIE_RL=$(mktemp)
COOKIE_EMAIL=$(mktemp)
HEADERS_A=$(mktemp)
HEADERS_EMAIL=$(mktemp)
LOGIN_A_BODY_TMP=$(mktemp)
MATCHING_TMP=$(mktemp)
trap 'rm -f "$COOKIE_A" "$COOKIE_B" "$COOKIE_RL" "$COOKIE_EMAIL" "$HEADERS_A" "$HEADERS_EMAIL" "$LOGIN_A_BODY_TMP" "$MATCHING_TMP"' EXIT

# ─── [1] API liveness ─────────────────────────────────────────────────────────
echo "--- [1] API liveness ---"
S=$(wait_http_status "GET $API/health" "200" 12 3 "$API/health")
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

# ─── [2b] Email runtime réel (optionnel) ─────────────────────────────────────
echo "--- [2b] Email runtime réel (optionnel) ---"
if [ "${SMOKE_EMAIL_REAL:-0}" != "1" ]; then
  echo "  SKIP Email runtime réel désactivé (exporter SMOKE_EMAIL_REAL=1 pour activer)"
  OPTIONAL_SKIP=$((OPTIONAL_SKIP + 1))
else
  if [ -z "${OPS_TEST_EMAIL:-}" ]; then
    printf "  \033[31mFAIL\033[0m OPS_TEST_EMAIL absent — le smoke réel refuse de tourner sans boîte canari dédiée\n"
    FAIL=$((FAIL + 1))
  elif [ "${APP_ENV:-}" != "vps" ] && [ "${APP_ENV:-}" != "pre-vps" ]; then
    printf "  \033[31mFAIL\033[0m APP_ENV doit valoir vps ou pre-vps pour SMOKE_EMAIL_REAL=1 (actuel: '%s')\n" "${APP_ENV:-<vide>}"
    FAIL=$((FAIL + 1))
  else
    EMAIL_CSRF=$(acquire_csrf "$COOKIE_EMAIL")
    REQUEST_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "")
    REQUEST_ID_ARGS=()
    if [ -n "$REQUEST_ID" ]; then
      REQUEST_ID_ARGS=(-H "X-Request-Id: $REQUEST_ID")
    fi
    # shellcheck disable=SC2086
    EMAIL_STATUS=$(curl -sk $CURL_RESOLVE \
      -c "$COOKIE_EMAIL" -b "$COOKIE_EMAIL" \
      -D "$HEADERS_EMAIL" \
      -X POST "$API/auth/forgot-password" \
      -H "Content-Type: application/json" \
      -H "Origin: $SMOKE_ORIGIN" \
      -H "X-CSRF-Token: $EMAIL_CSRF" \
      "${REQUEST_ID_ARGS[@]}" \
      -d "{\"email\":\"$OPS_TEST_EMAIL\"}" \
      -o /dev/null \
      -w "%{http_code}")
    check "POST /auth/forgot-password canari → 200" "$EMAIL_STATUS" "200"
    EMAIL_REQ_ID=$(grep -i '^x-request-id:' "$HEADERS_EMAIL" | tail -1 | awk '{print $2}' | tr -d '\r')
    if [ "$EMAIL_STATUS" = "200" ]; then
      printf "  INFO corrélation logs email: x-request-id=%s ; chercher AUTH_FORGOT_PASSWORD_REQUEST / EMAIL_SEND_* dans les logs API\n" "${EMAIL_REQ_ID:-${REQUEST_ID:-unknown}}"
    fi
  fi
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
  -H "Origin: $SMOKE_ORIGIN" \
  -d '{"email":"smoke@test.invalid","password":"wrong"}')
check "POST /auth/login via HTTPS répond (non 000)" \
  "$([ "$S" != "000" ] && echo ok || echo fail)" "ok"

# ─── [5b] TLS strict — certificat réel (prod uniquement) ────────────────────
echo "--- [5b] TLS strict (cert valide, sans -k) ---"
if [ -n "$CURL_RESOLVE" ]; then
  echo "  SKIP [5b] mode local (CURL_RESOLVE actif — cert auto-signé attendu)"
  echo "       OBLIGATOIRE en prod : relancer avec API_BASE_URL=https://api.blobsurf.com"
  SKIP=$((SKIP + 1))
else
  TLS_STATUS=$(http_status_strict "$API/health" 2>/dev/null || echo "000")
  check "TLS strict → /health 200 (cert Let's Encrypt valide)" "$TLS_STATUS" "200"
  if [ "$TLS_STATUS" = "000" ]; then
    echo "       FAIL BLOQUANT: curl refuse le cert — expiré / auto-signé / mismatch CN"
    echo "       Un attaquant MitM peut intercepter tout le trafic en clair"
  fi
fi

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
# -w "%{http_code}" : HTTP/2-safe (évite parsing fragile grep "^HTTP")
# -o file : body dans fichier séparé pour inspection
LOGIN_A_STATUS=$(curl -sk $CURL_RESOLVE \
  -c "$COOKIE_A" -b "$COOKIE_A" \
  -D "$HEADERS_A" \
  -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $SMOKE_ORIGIN" \
  -H "X-CSRF-Token: $CSRF_A" \
  -d "{\"email\":\"$RIDER_A_EMAIL\",\"password\":\"$RIDER_A_PASS\"}" \
  -o "$LOGIN_A_BODY_TMP" \
  -w "%{http_code}")
LOGIN_A=$(cat "$LOGIN_A_BODY_TMP")
check "POST /auth/login rider A → 200" "$LOGIN_A_STATUS" "200"
check_contains "Réponse login A = ok" "$LOGIN_A" '"ok"'
COOKIE_SECURE=$(grep -i "set-cookie" "$HEADERS_A" || true)
check_contains "Cookie Secure présent"   "$COOKIE_SECURE" "Secure"
check_contains "Cookie HttpOnly présent" "$COOKIE_SECURE" "HttpOnly"
SAMESITE_LINE=$(echo "$COOKIE_SECURE" | grep -i "samesite" | head -1 || true)
check "Cookie SameSite=Lax ou Strict" \
  "$(echo "$SAMESITE_LINE" | grep -qi "samesite=lax\|samesite=strict" && echo ok || echo fail)" "ok"
CSRF_A_POST=$(acquire_csrf "$COOKIE_A")

# ─── [8] Auth rider B ─────────────────────────────────────────────────────────
echo "--- [8] Auth rider B ---"
CSRF_B=$(acquire_csrf "$COOKIE_B")
# shellcheck disable=SC2086
LOGIN_B_STATUS=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
  -c "$COOKIE_B" -b "$COOKIE_B" \
  -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $SMOKE_ORIGIN" \
  -H "X-CSRF-Token: $CSRF_B" \
  -d "{\"email\":\"$RIDER_B_EMAIL\",\"password\":\"$RIDER_B_PASS\"}")
check "POST /auth/login rider B → 200" "$LOGIN_B_STATUS" "200"
CSRF_B_POST=$(acquire_csrf "$COOKIE_B")

# ─── [9] Profil rider A ───────────────────────────────────────────────────────
echo "--- [9] Profil rider A ---"
PROFILE_A_STATUS=$(http_status -b "$COOKIE_A" \
  -H "Origin: $SMOKE_ORIGIN" \
  "$API/profile/me")
check "GET /profile/me rider A → 200" "$PROFILE_A_STATUS" "200"
PROFILE_A=$(http_body -b "$COOKIE_A" \
  -H "Origin: $SMOKE_ORIGIN" \
  "$API/profile/me")
check_contains "Profil A contient UUID connu" "$PROFILE_A" "$RIDER_A_UUID"

# ─── [10] Profil rider B ──────────────────────────────────────────────────────
echo "--- [10] Profil rider B ---"
PROFILE_B_STATUS=$(http_status -b "$COOKIE_B" \
  -H "Origin: $SMOKE_ORIGIN" \
  "$API/profile/me")
check "GET /profile/me rider B → 200" "$PROFILE_B_STATUS" "200"

# ─── [11] Matching POST ───────────────────────────────────────────────────────
echo "--- [11] Matching POST rider A ---"
# Un seul appel curl : status via -w, body via -o (élimine la race condition double-requête)
# shellcheck disable=SC2086
MATCHING_STATUS=$(curl -sk $CURL_RESOLVE \
  -b "$COOKIE_A" \
  -H "Origin: $SMOKE_ORIGIN" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
  -X POST "$API/matching/search" \
  -d '{"sport":"surf","level":"intermediate","date":"anytime","location":{"lat":43.4832,"lng":-1.5586},"distanceKm":100}' \
  -o "$MATCHING_TMP" \
  -w "%{http_code}")
MATCHING=$(cat "$MATCHING_TMP")
check "POST /matching/search → 200" "$MATCHING_STATUS" "200"
MATCHING_RESULTS=$(echo "$MATCHING" | jq '.results // []' 2>/dev/null || echo "[]")
check_contains "Matching contient results[]" "$MATCHING" '"results"'
# Résultats vides → geo-privacy non vérifiable (index géospatial cassé ?)
if [ "$MATCHING_RESULTS" = "[]" ]; then
  printf "  \033[31mFAIL\033[0m Résultats matching vides — checks geo-privacy non vérifiables\n"
  printf "       (index géospatial cassé ou aucun pro seedé dans le rayon de test)\n"
  FAIL=$((FAIL + 1))
else
  check_not_contains "Résultats matching sans lat brut"  "$MATCHING_RESULTS" '"lat":'
  check_not_contains "Résultats matching sans lng brut"  "$MATCHING_RESULTS" '"lng":'
fi

# ─── [12] Ouverture conversation ──────────────────────────────────────────────
echo "--- [12] Ouverture conversation A → B ---"
# shellcheck disable=SC2086
CONV_STATUS=$(curl -sk $CURL_RESOLVE -o /dev/null -w "%{http_code}" \
  -c "$COOKIE_A" -b "$COOKIE_A" \
  -H "Origin: $SMOKE_ORIGIN" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: ${CSRF_A_POST:-$CSRF_A}" \
  -X POST "$API/conversations/open" \
  -d "{\"targetUserId\":\"$RIDER_B_UUID\"}")
check "POST /conversations/open → 200 ou 201" \
  "$([ "$CONV_STATUS" = "200" ] || [ "$CONV_STATUS" = "201" ] && echo ok || echo fail)" "ok"
# shellcheck disable=SC2086
CONV_BODY=$(curl -sk $CURL_RESOLVE \
  -b "$COOKIE_A" \
  -H "Origin: $SMOKE_ORIGIN" \
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
    -H "Origin: $SMOKE_ORIGIN" \
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
  -H "Origin: $SMOKE_ORIGIN" \
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
    -H "Origin: $SMOKE_ORIGIN" \
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
STORAGE_DOMAIN_CHECK="$(extract_host "$STORAGE")"
SMOKE_KEY="pros/smoke-test-vps/$(date +%s)-test.txt"
SMOKE_CONTENT="smoke-test-vps-$(date +%s)"

# ─── [17] Storage domain joignable via Caddy HTTPS (Let's Encrypt) ───────────
echo "--- [17] Storage domain via Caddy HTTPS ---"
# MinIO health endpoint est accessible publiquement (pas de policy sur /minio/health/live)
STORAGE_S=$(wait_http_status "GET $STORAGE/minio/health/live" "200" 8 3 "$STORAGE/minio/health/live")
check "GET $STORAGE/minio/health/live → 200" "$STORAGE_S" "200"

# ─── [18] Presigned PUT URL sans localhost ─────────────────────────────────────
echo "--- [18] Presigned PUT URL — pas de localhost ---"
# Acquérir une URL présignée via l'API (endpoint upload avatar — ou endpoint générique si disponible)
# On utilise le endpoint de presign d'avatar (si disponible) ou on teste directement via AWS SDK.
# Ici on teste via l'API /profile/upload-avatar qui retourne une presigned URL.
# shellcheck disable=SC2086
PRESIGN_RESP=$(curl -sk $CURL_RESOLVE \
  -b "$COOKIE_A" \
  -H "Origin: $SMOKE_ORIGIN" \
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

# ─── [19b] Caddy bloque Content-Type hostile — XSS polyglot guard ─────────────
# Caddy implémente ce guard via le matcher @bad_put dans docker/Caddyfile.
echo "--- [19b] Caddy rejette Content-Type: text/html (XSS upload guard) ---"
if [ -n "$PRESIGN_URL" ]; then
  # Caddy doit intercepter et retourner 415 AVANT que MinIO valide la signature
  # Si on obtient 403 → Caddy laisse passer (MinIO refuse via HMAC) → restriction ABSENTE
  # Si on obtient 200 → Caddy ET MinIO acceptent text/html → DANGER CRITIQUE
  CT_REJECT=$(curl -sk \
    $CURL_RESOLVE \
    -X PUT "$PRESIGN_URL" \
    -H "Content-Type: text/html" \
    --data-binary "<script>alert(1)</script>" \
    -o /dev/null \
    -w "%{http_code}" 2>/dev/null || echo "000")
  check "PUT Content-Type: text/html → 415 (Caddy bloque XSS polyglot)" \
    "$([ "$CT_REJECT" = "415" ] && echo ok || echo fail)" "ok"
  if [ "$CT_REJECT" != "415" ]; then
    echo "       HTTP obtenu: $CT_REJECT"
    if [ "$CT_REJECT" = "200" ]; then
      echo "       DANGER CRITIQUE: HTML/JS uploadable — XSS via URL storage CDN possible"
    elif [ "$CT_REJECT" = "403" ]; then
      echo "       Caddy ne bloque PAS (MinIO refuse via HMAC — protection absente côté Caddy)"
    fi
    echo "       Action: vérifier Caddyfile matcher @bad_put (Content-Type restriction PUT) dans docker/Caddyfile"
  fi
else
  printf "  \033[31mFAIL\033[0m [19b] SKIP — presigned URL absente\n"
  FAIL=$((FAIL + 1))
fi

# ─── [20] Lecture anonyme users/* interdite ───────────────────────────────────
echo "--- [20] Lecture anonyme users/* interdite ---"
if [ -n "$PRESIGN_URL" ] && [ "$UPLOAD_STATUS" = "200" ]; then
  # Extraire la clé depuis la presigned URL (path après le bucket)
  PRESIGN_PATH=$(echo "$PRESIGN_URL" | sed 's/?.*//' | sed "s|.*/${S3_BUCKET_CHECK}/||")
  UPLOADED_READ_URL="${STORAGE}/${S3_BUCKET_CHECK}/${PRESIGN_PATH}"

  UPLOADED_READ_STATUS=$(curl -sk \
    $CURL_RESOLVE \
    -o /dev/null \
    -w "%{http_code}" \
    "$UPLOADED_READ_URL" 2>/dev/null || echo "000")
  check "GET objet users/* uploadé sans auth → 403/404" \
    "$([ "$UPLOADED_READ_STATUS" = "403" ] || [ "$UPLOADED_READ_STATUS" = "404" ] && echo ok || echo fail)" "ok"
  if [ "$UPLOADED_READ_STATUS" != "403" ] && [ "$UPLOADED_READ_STATUS" != "404" ]; then
    echo "       URL testée: ${STORAGE}/${S3_BUCKET_CHECK}/<redacted-users-key>"
    echo "       HTTP status: $UPLOADED_READ_STATUS"
    echo "       DANGER: users/* est lisible anonymement alors que seule l'écriture par URL présignée est attendue."
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

  # Test [20b] : contournement via S3 ListObjectsV2 API (chemin alternatif au /)
  LIST_V2_STATUS=$(curl -sk \
    $CURL_RESOLVE \
    -o /dev/null \
    -w "%{http_code}" \
    "${STORAGE}/${S3_BUCKET_CHECK}/?list-type=2" 2>/dev/null || echo "000")
  check "GET /?list-type=2 → 403 (ListObjectsV2 interdit)" \
    "$([ "$LIST_V2_STATUS" = "403" ] && echo ok || echo fail)" "ok"
  if [ "$LIST_V2_STATUS" != "403" ]; then
    echo "       WARN: ListObjectsV2 retourne HTTP $LIST_V2_STATUS"
    echo "       Un attaquant peut énumérer tous les objets du bucket via ?list-type=2"
  fi

  # Test négatif : un préfixe non public doit rester inaccessible en lecture anonyme.
  PRIVATE_PREFIX_STATUS=$(curl -sk \
    $CURL_RESOLVE \
    -o /dev/null \
    -w "%{http_code}" \
    "${STORAGE}/${S3_BUCKET_CHECK}/users/smoke-test-vps/private-probe.txt" 2>/dev/null || echo "000")
  check "GET préfixe users/* non autorisé → 403/404 (pas de lecture publique large)" \
    "$([ "$PRIVATE_PREFIX_STATUS" = "403" ] || [ "$PRIVATE_PREFIX_STATUS" = "404" ] && echo ok || echo fail)" "ok"
  if [ "$PRIVATE_PREFIX_STATUS" != "403" ] && [ "$PRIVATE_PREFIX_STATUS" != "404" ]; then
    echo "       WARN: users/* retourne HTTP $PRIVATE_PREFIX_STATUS"
  fi
else
  printf "  \033[31mFAIL\033[0m [20] SKIP — upload [19] absent ou échoué, test de lecture sans valeur probante\n"
  FAIL=$((FAIL + 1))
fi

# ─── [21] CORS preflight OPTIONS sur le storage domain ───────────────────────
# Prouve que le navigateur peut envoyer un PUT cross-origin vers storage.$DOMAIN.
# Sans ces headers, fetch(presignedUrl, {method:'PUT'}) est bloqué par le browser
# (profile/page.tsx:486, pro/profile/page.tsx:481).
echo "--- [21] CORS preflight OPTIONS (storage domain → app domain) ---"
# L'origin testée est la même origine navigateur que les appels API du smoke.
CORS_TEST_ORIGIN="$SMOKE_ORIGIN"
CORS_RESP=$(curl -sk \
  $CURL_RESOLVE \
  -D - \
  -X OPTIONS \
  "${STORAGE}/${S3_BUCKET_CHECK}/probe-cors-smoke" \
  -H "Origin: ${CORS_TEST_ORIGIN}" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -o /dev/null 2>/dev/null || echo "CURL_FAILED")

CORS_ORIGIN=$(echo "$CORS_RESP" | grep -i "access-control-allow-origin" | head -1 | tr -d '\r')
CORS_METHOD=$(echo "$CORS_RESP" | grep -i "access-control-allow-method" | head -1 | tr -d '\r')
CORS_HDRS=$(echo "$CORS_RESP"  | grep -i "access-control-allow-header" | head -1 | tr -d '\r')

check_contains "CORS OPTIONS → Access-Control-Allow-Origin présent" "$CORS_ORIGIN" "$SMOKE_ORIGIN"
check_contains "CORS OPTIONS → Access-Control-Allow-Methods contient PUT" "$CORS_METHOD" "PUT"
check_contains "CORS OPTIONS → Allow-Headers contient Content-Type" "$CORS_HDRS" "Content-Type"

if [ -z "$CORS_ORIGIN" ] || [ -z "$CORS_METHOD" ] || [ -z "$CORS_HDRS" ]; then
  echo "       Origin testée : ${CORS_TEST_ORIGIN}"
  echo "       CORS_ORIGIN:   '${CORS_ORIGIN}'"
  echo "       CORS_METHOD:   '${CORS_METHOD}'"
  echo "       CORS_HEADERS:  '${CORS_HDRS}'"
  echo "       FAIL: les uploads photo navigateur (RIDER + PRO) seront bloqués par le browser."
  echo "       Stack Caddy : vérifier docker/Caddyfile (section storage CORS, matcher @preflight et @from_app)"
fi

# ─── [21b] CORS storage — origin hostile doit être rejetée ───────────────────
echo "--- [21b] CORS storage — origin hostile rejetée ---"
CORS_HOSTILE=$(curl -sk \
  $CURL_RESOLVE \
  -D - \
  -X OPTIONS \
  "${STORAGE}/${S3_BUCKET_CHECK}/probe-cors-hostile" \
  -H "Origin: https://attacker.example" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -o /dev/null 2>/dev/null || echo "")
CORS_HOSTILE_ORIGIN=$(echo "$CORS_HOSTILE" | grep -i "access-control-allow-origin" | head -1 | tr -d '\r')
check_not_contains "CORS storage : origin hostile absente" "$CORS_HOSTILE_ORIGIN" "attacker.example"
# grep -F : correspondance littérale — évite que * soit interprété comme quantificateur regex
# détecte : "*", "*.blobinfini.local", toute valeur contenant le caractère *
if echo "$CORS_HOSTILE_ORIGIN" | grep -qF "*"; then
  printf "  \033[31mFAIL\033[0m CORS storage : wildcard * détecté (valeur: '%s')\n" "$CORS_HOSTILE_ORIGIN"
  FAIL=$((FAIL + 1))
else
  printf "  \033[32mOK\033[0m   CORS storage : pas de wildcard (*) — grep -F littéral\n"
  PASS=$((PASS + 1))
fi
if echo "$CORS_HOSTILE_ORIGIN" | grep -qF "attacker.example"; then
  echo "       DANGER: storage accepte des origins hostiles — CORS bypass possible"
fi

# ─── [22] sw.js — Cache-Control no-store ─────────────────────────────────────
# sw.js ne doit jamais être mis en cache par Cloudflare ou le navigateur.
# Un SW périmé peut verrouiller les utilisateurs sur une ancienne version après deploy.
# Ce check valide que Caddy force bien no-store (correctif Caddyfile PR #228).
echo "--- [22] sw.js Cache-Control no-store ---"
# shellcheck disable=SC2086
SW_HDR=$(curl -sk $CURL_RESOLVE -D - -o /dev/null "${WEB}/sw.js" 2>/dev/null \
  | grep -i "^cache-control:" | tr -d '\r' | head -1)
check_contains     "sw.js : no-store présent"              "$SW_HDR" "no-store"
check_not_contains "sw.js : pas de public ni max-age>0"    "$SW_HDR" "max-age=[1-9]"
if echo "$SW_HDR" | grep -qi "public"; then
  printf "  \033[31mFAIL\033[0m sw.js : 'public' détecté dans Cache-Control — Cloudflare va cacher le SW\n"
  printf "       Valeur reçue : '%s'\n" "$SW_HDR"
  printf "       Vérifier docker/Caddyfile bloc 'handle /sw.js'\n"
  FAIL=$((FAIL + 1))
else
  printf "  \033[32mOK\033[0m   sw.js : 'public' absent du Cache-Control\n"
  PASS=$((PASS + 1))
fi

# ─── Résumé final ─────────────────────────────────────────────────────────────
echo ""
echo "======================================"
TOTAL=$((PASS + FAIL))
printf "  Résultat : %d/%d checks passés\n" "$PASS" "$TOTAL"
printf "  Fonctionnel : 1-16 | S3 VPS proof : 17-22\n"
if [ "$SKIP" -gt 0 ]; then
  printf "  Checks bloquants ignorés (SKIP) : %d\n" "$SKIP"
fi
if [ "$OPTIONAL_SKIP" -gt 0 ]; then
  printf "  Checks optionnels ignorés : %d\n" "$OPTIONAL_SKIP"
fi
if [ "$FAIL" -gt 0 ]; then
  printf "  \033[31mVERDICT : NO-GO (%d échec(s))\033[0m\n" "$FAIL"
  echo "======================================"
  exit 1
elif [ "$SKIP" -gt 0 ]; then
  printf "  \033[33mVERDICT : GO LOCAL ONLY — TLS NON VALIDÉ (%d check(s) ignoré(s))\033[0m\n" "$SKIP"
  printf "  Relancer en prod : API_BASE_URL=https://api.blobsurf.com ./scripts/smoke-test-vps.sh\n"
  echo "======================================"
  exit 2
else
  printf "  \033[32mVERDICT : GO VPS ✓\033[0m\n"
  echo "======================================"
  exit 0
fi
