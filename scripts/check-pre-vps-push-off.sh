#!/usr/bin/env bash
# check-pre-vps-push-off.sh — Contrôleur (LECTURE SEULE) de l'état pré-VPS quand
# Firebase TEST est injecté avec PUSH_NOTIFICATIONS_ENABLED=false.
#
# C'est un CONTRÔLEUR, pas un opérateur :
#   - ne build pas, ne fait pas `up -d`, ne modifie aucun .env, n'active jamais le push.
#   - n'affiche JAMAIS de valeur sensible : uniquement OK / FAIL / SKIP.
#
# Usage :
#   bash scripts/check-pre-vps-push-off.sh
#
# Variables d'environnement (optionnelles) :
#   APP_URL            (défaut https://app.blobinfini.local)
#   API_URL            (défaut https://api.blobinfini.local)
#   COMPOSE_FILE       (défaut docker-compose.pre-vps.yml)
#   ENV_FILE           (défaut .env.pre-vps)
#   TEST_ACCESS_COOKIE (si fourni : teste /push/status authentifié → attendu 404 ;
#                       sinon SKIP. JAMAIS affiché.)
#
# Mode test interne (ne pas utiliser en prod) :
#   PUSHOFF_MOCK=1 + MOCK_* → stub curl/docker pour un dry-run hors stack live.
set -euo pipefail

APP_URL="${APP_URL:-https://app.blobinfini.local}"
API_URL="${API_URL:-https://api.blobinfini.local}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.pre-vps.yml}"
ENV_FILE="${ENV_FILE:-.env.pre-vps}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK="${PUSHOFF_MOCK:-0}"

FAILS=0
ok()   { printf '  OK   | %s\n' "$1"; }
fail() { printf '  FAIL | %s\n' "$1"; FAILS=$((FAILS + 1)); }
skip() { printf '  SKIP | %s\n' "$1"; }

# ─── Wrappers I/O (mockables, ne fuient jamais de valeur) ─────────────────────
sw_code() {
  if [ "$MOCK" = "1" ]; then printf '%s' "${MOCK_SW_CODE:-000}"; return; fi
  local c; c="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$APP_URL/sw.js" 2>/dev/null)" || true
  printf '%s' "${c:-000}"
}
sw_headers() {
  if [ "$MOCK" = "1" ]; then printf '%s\n' "${MOCK_SW_HEADERS:-}"; return; fi
  curl -skI --max-time 10 "$APP_URL/sw.js" 2>/dev/null || true
}
status_code_noauth() {
  if [ "$MOCK" = "1" ]; then printf '%s' "${MOCK_STATUS_NOAUTH:-000}"; return; fi
  local c; c="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$API_URL/push/status" 2>/dev/null)" || true
  printf '%s' "${c:-000}"
}
status_code_auth() {
  # Le cookie n'est jamais affiché ni loggé.
  if [ "$MOCK" = "1" ]; then printf '%s' "${MOCK_STATUS_AUTH:-000}"; return; fi
  local c; c="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
    --cookie "accessToken=${TEST_ACCESS_COOKIE:-}" "$API_URL/push/status" 2>/dev/null)" || true
  printf '%s' "${c:-000}"
}
compose_ps() {
  if [ "$MOCK" = "1" ]; then printf '%s\n' "${MOCK_PS:-}"; return; fi
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || true
}
compose_logs() {
  if [ "$MOCK" = "1" ]; then printf '%s\n' "${MOCK_LOGS:-}"; return; fi
  docker compose -f "$COMPOSE_FILE" logs --since 15m api 2>/dev/null || true
}
run_env_validator() {
  if [ "$MOCK" = "1" ]; then return "${MOCK_VALIDATOR_RC:-0}"; fi
  APP_ENV=pre-vps NODE_ENV=pre-vps bash "$ROOT/scripts/check-pre-vps-env.sh" "$ENV_FILE" >/dev/null 2>&1
}

echo "=== Contrôle pré-VPS push OFF (lecture seule) ==="
echo "APP_URL=$APP_URL  API_URL=$API_URL  COMPOSE_FILE=$COMPOSE_FILE  ENV_FILE=$ENV_FILE"
echo ""

# 1. .env.pre-vps existe
if [ -f "$ENV_FILE" ]; then ok "ENV_FILE présent ($ENV_FILE)"; else fail "ENV_FILE absent ($ENV_FILE)"; fi

# 2. PUSH_NOTIFICATIONS_ENABLED=false (et JAMAIS true)
if [ -f "$ENV_FILE" ] && grep -qE '^[[:space:]]*PUSH_NOTIFICATIONS_ENABLED[[:space:]]*=[[:space:]]*true' "$ENV_FILE"; then
  fail "PUSH_NOTIFICATIONS_ENABLED=true détecté — push DOIT rester OFF ici"
elif [ -f "$ENV_FILE" ] && grep -qE '^[[:space:]]*PUSH_NOTIFICATIONS_ENABLED[[:space:]]*=[[:space:]]*false' "$ENV_FILE"; then
  ok "PUSH_NOTIFICATIONS_ENABLED=false"
else
  fail "PUSH_NOTIFICATIONS_ENABLED non défini à false dans $ENV_FILE"
fi

# 3. Validateur d'env pré-VPS (n'affiche que des noms de variables)
if run_env_validator; then ok "check-pre-vps-env.sh passe"; else fail "check-pre-vps-env.sh échoue (voir détail en le lançant manuellement)"; fi

# 4. docker compose ps : api + web présents et up/healthy
PS_OUT="$(compose_ps)"
if [ -z "$PS_OUT" ]; then
  fail "docker compose ps indisponible (docker absent ou stack non lancée)"
else
  for svc in api web; do
    if printf '%s\n' "$PS_OUT" | grep -E "(^|[[:space:]/_-])${svc}([[:space:]/_-]|\$)" | grep -Eiq 'up|running|healthy'; then
      ok "service '$svc' présent et up/healthy"
    else
      fail "service '$svc' absent ou non up/healthy"
    fi
  done
fi

# 5. /sw.js → 200
SW_CODE="$(sw_code)"
if [ "$SW_CODE" = "200" ]; then ok "/sw.js HTTP 200"; else fail "/sw.js HTTP $SW_CODE (attendu 200)"; fi

# 6. /sw.js headers : Service-Worker-Allowed + Cache-Control no-store/no-cache/must-revalidate
SW_HDR="$(sw_headers)"
if printf '%s\n' "$SW_HDR" | grep -iq '^service-worker-allowed:[[:space:]]*/'; then
  ok "header Service-Worker-Allowed: /"
else
  fail "header Service-Worker-Allowed manquant"
fi
if printf '%s\n' "$SW_HDR" | grep -iqE '^cache-control:.*(no-store|no-cache|must-revalidate)'; then
  ok "header Cache-Control (no-store/no-cache/must-revalidate)"
else
  fail "header Cache-Control attendu manquant"
fi

# 7. /push/status SANS session → 401 (route présente, auth-gate actif)
NOAUTH="$(status_code_noauth)"
if [ "$NOAUTH" = "401" ]; then ok "/push/status sans session → 401"; else fail "/push/status sans session → $NOAUTH (attendu 401)"; fi

# 8. /push/status AVEC session test → 404 quand push OFF (uniquement si cookie fourni)
if [ -n "${TEST_ACCESS_COOKIE:-}" ]; then
  AUTH="$(status_code_auth)"
  if [ "$AUTH" = "404" ]; then ok "/push/status authentifié → 404 (push OFF)"; else fail "/push/status authentifié → $AUTH (attendu 404 avec push OFF)"; fi
else
  skip "/push/status authentifié (TEST_ACCESS_COOKIE non fourni)"
fi

# 9. Logs api récents : aucune fuite de secret/token
LOGS="$(compose_logs)"
if [ -z "$LOGS" ]; then
  skip "logs api indisponibles (docker absent ou pas de logs)"
elif printf '%s\n' "$LOGS" | grep -iqE 'BEGIN PRIVATE KEY|FIREBASE_PRIVATE_KEY|registration token|vapid|fcm[-_ ]?token'; then
  fail "fuite potentielle de secret/token dans les logs api"
else
  ok "logs api : aucun secret/token visible"
fi

echo ""
if [ "$FAILS" -eq 0 ]; then
  echo "=== RÉSULTAT : OK ($FAILS FAIL) — état pré-VPS push OFF conforme ==="
  exit 0
else
  echo "=== RÉSULTAT : ÉCHEC ($FAILS FAIL) — voir lignes FAIL ci-dessus ==="
  exit 1
fi
