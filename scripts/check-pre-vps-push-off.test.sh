#!/usr/bin/env bash
# Tests (dry-run mock) du contrôleur check-pre-vps-push-off.sh.
# Auto-suffisant : utilise PUSHOFF_MOCK=1 pour stubber curl/docker, sans stack live.
# Aucune vraie valeur sensible (cookie/clé) — placeholders factices uniquement.
#
# Usage : bash scripts/check-pre-vps-push-off.test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/check-pre-vps-push-off.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ENV_OFF="$WORK/env.off"; printf 'PUSH_NOTIFICATIONS_ENABLED=false\n' > "$ENV_OFF"
ENV_ON="$WORK/env.on";   printf 'PUSH_NOTIFICATIONS_ENABLED=true\n'  > "$ENV_ON"

GOOD_HEADERS=$'HTTP/2 200\ncache-control: no-cache, no-store, must-revalidate\nservice-worker-allowed: /'
GOOD_PS=$'NAME                IMAGE   STATUS\nblobinfini-api-1    x       Up (healthy)\nblobinfini-web-1    x       Up (healthy)'

PASS=0; FAIL=0
# run_ctrl : exporte les MOCK_* passés en "K=V", lance le script, capture out+rc.
run_ctrl() {
  local rc out
  out="$(env PUSHOFF_MOCK=1 "$@" bash "$SCRIPT" 2>&1)"; rc=$?
  LAST_OUT="$out"; LAST_RC=$rc
}
expect_rc()       { if [ "$LAST_RC" = "$2" ]; then echo "  ✓ $1 (rc=$2)"; PASS=$((PASS+1)); else echo "  ✗ $1 (rc=$LAST_RC, attendu $2)"; FAIL=$((FAIL+1)); fi; }
expect_line()     { if grep -qF "$2" <<<"$LAST_OUT"; then echo "  ✓ $1"; PASS=$((PASS+1)); else echo "  ✗ $1 — attendu: $2"; FAIL=$((FAIL+1)); fi; }
expect_absent()   { if grep -qF "$2" <<<"$LAST_OUT"; then echo "  ✗ $1 — inattendu: $2"; FAIL=$((FAIL+1)); else echo "  ✓ $1"; PASS=$((PASS+1)); fi; }

COMMON=(ENV_FILE="$ENV_OFF" MOCK_VALIDATOR_RC=0 MOCK_PS="$GOOD_PS" MOCK_SW_CODE=200 \
        MOCK_SW_HEADERS="$GOOD_HEADERS" MOCK_STATUS_NOAUTH=401 MOCK_LOGS="api ready")

echo "=== Tests dry-run check-pre-vps-push-off.sh ==="

echo "[A] tout conforme, sans cookie → OK + SKIP auth"
run_ctrl "${COMMON[@]}"
expect_rc "exit 0" 0
expect_line "flag OFF OK" "OK   | PUSH_NOTIFICATIONS_ENABLED=false"
expect_line "sw 200 OK" "OK   | /sw.js HTTP 200"
expect_line "SW-Allowed OK" "OK   | header Service-Worker-Allowed: /"
expect_line "noauth 401 OK" "OK   | /push/status sans session → 401"
expect_line "auth SKIP" "SKIP | /push/status authentifié (TEST_ACCESS_COOKIE non fourni)"
expect_line "logs OK" "OK   | logs api : aucun secret/token visible"

echo "[B] flag ON → FAIL"
run_ctrl ENV_FILE="$ENV_ON" MOCK_VALIDATOR_RC=0 MOCK_PS="$GOOD_PS" MOCK_SW_CODE=200 \
         MOCK_SW_HEADERS="$GOOD_HEADERS" MOCK_STATUS_NOAUTH=401 MOCK_LOGS="ok"
expect_rc "exit 1" 1
expect_line "flag ON détecté" "FAIL | PUSH_NOTIFICATIONS_ENABLED=true détecté"

echo "[C] /sw.js 500 → FAIL"
run_ctrl "${COMMON[@]}" MOCK_SW_CODE=500
expect_rc "exit 1" 1
expect_line "sw 500 FAIL" "FAIL | /sw.js HTTP 500 (attendu 200)"

echo "[D] header Service-Worker-Allowed manquant → FAIL"
run_ctrl "${COMMON[@]}" MOCK_SW_HEADERS=$'HTTP/2 200\ncache-control: no-store'
expect_rc "exit 1" 1
expect_line "header manquant FAIL" "FAIL | header Service-Worker-Allowed manquant"

echo "[E] /push/status sans session = 200 (au lieu de 401) → FAIL"
run_ctrl "${COMMON[@]}" MOCK_STATUS_NOAUTH=200
expect_rc "exit 1" 1
expect_line "noauth FAIL" "FAIL | /push/status sans session → 200 (attendu 401)"

echo "[F] cookie fourni + /push/status auth = 200 (au lieu de 404) → FAIL + pas de fuite cookie"
run_ctrl "${COMMON[@]}" TEST_ACCESS_COOKIE="cookie-factice-NE-PAS-AFFICHER-123" MOCK_STATUS_AUTH=200
expect_rc "exit 1" 1
expect_line "auth FAIL" "FAIL | /push/status authentifié → 200 (attendu 404 avec push OFF)"
expect_absent "cookie jamais affiché" "cookie-factice-NE-PAS-AFFICHER-123"

echo "[G] cookie fourni + /push/status auth = 404 → OK"
run_ctrl "${COMMON[@]}" TEST_ACCESS_COOKIE="cookie-factice-XYZ" MOCK_STATUS_AUTH=404
expect_rc "exit 0" 0
expect_line "auth 404 OK" "OK   | /push/status authentifié → 404 (push OFF)"
expect_absent "cookie jamais affiché" "cookie-factice-XYZ"

echo "[H] logs contenant une clé privée → FAIL (anti-fuite)"
run_ctrl "${COMMON[@]}" MOCK_LOGS=$'api start\n-----BEGIN PRIVATE KEY-----\napi ready'
expect_rc "exit 1" 1
expect_line "leak FAIL" "FAIL | fuite potentielle de secret/token dans les logs api"

echo ""
echo "=== Résultat : $PASS OK / $FAIL échec(s) ==="
[ "$FAIL" -eq 0 ]
