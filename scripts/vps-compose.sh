#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.vps.yml"
ENV_FILE="${ROOT_DIR}/.env.vps"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: missing ${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: missing ${ENV_FILE}" >&2
  exit 1
fi

exec docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
