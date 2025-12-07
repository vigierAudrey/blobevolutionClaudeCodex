#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "[security-health] curl est requis" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[security-health] jq est requis pour parser la réponse JSON" >&2
  exit 1
fi

: "${SECURITY_HEALTH_URL:?Variable SECURITY_HEALTH_URL manquante}"
: "${SECURITY_HEALTH_TOKEN:?Variable SECURITY_HEALTH_TOKEN manquante}"

response=$(curl -fsS \
  -H "Authorization: Bearer ${SECURITY_HEALTH_TOKEN}" \
  -H "Accept: application/json" \
  "${SECURITY_HEALTH_URL}" \
  || true)

if [[ -z "${response}" ]]; then
  echo "[security-health] impossible de récupérer ${SECURITY_HEALTH_URL}" >&2
  [[ -n "${HC_FAIL_URL:-}" ]] && curl -fsS -X POST "${HC_FAIL_URL}" -d "status=DOWN&issues=unreachable" >/dev/null || true
  exit 1
fi

status=$(echo "${response}" | jq -r '.status // "UNKNOWN"')
issues=$(echo "${response}" | jq -r '.issues | join(", ") // ""')

if [[ "${status}" != "SECURE" ]]; then
  echo "[security-health] statut=${status} issues=${issues}" >&2
  [[ -n "${HC_FAIL_URL:-}" ]] && curl -fsS -X POST "${HC_FAIL_URL}" -d "status=${status}&issues=${issues}" >/dev/null || true
  exit 1
fi

echo "[security-health] OK – statut SECURE"

if [[ -n "${HC_OK_URL:-}" ]]; then
  curl -fsS "${HC_OK_URL}" >/dev/null || true
fi
