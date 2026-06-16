#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ENV="$(mktemp /tmp/minio-policy-test-env-XXXXXX)"
trap 'rm -f "$TMP_ENV"' EXIT

cat >"$TMP_ENV" <<'EOF'
S3_ACCESS_KEY_ID=test-access-key
S3_SECRET_ACCESS_KEY=test-secret-key-32chars-minimum
S3_BUCKET=blob-policy-test
EOF

POLICY_OUT="$(
  ENV_FILE="$TMP_ENV" \
  COMPOSE_FILE="$ROOT_DIR/docker-compose.vps.yml" \
  "$ROOT_DIR/scripts/minio-public-prefix-policy.sh" --dry-run --prefix 'pros/*'
)"

printf '%s\n' "$POLICY_OUT" | grep -F 'arn:aws:s3:::blob-policy-test/pros/*' >/dev/null

if printf '%s\n' "$POLICY_OUT" | grep -F 'arn:aws:s3:::blob-policy-test/*' >/dev/null; then
  echo "Unexpected bucket-wide public policy" >&2
  exit 1
fi

if printf '%s\n' "$POLICY_OUT" | grep -E 's3:ListBucket|users/|private/|documents/' >/dev/null; then
  echo "Unexpected private prefix or ListBucket grant" >&2
  exit 1
fi

CLEAR_OUT="$(
  ENV_FILE="$TMP_ENV" \
  COMPOSE_FILE="$ROOT_DIR/docker-compose.vps.yml" \
  "$ROOT_DIR/scripts/minio-public-prefix-policy.sh" --dry-run --clear
)"

printf '%s\n' "$CLEAR_OUT" | grep -F '"Statement":[]' >/dev/null

echo "minio public prefix policy tests OK"
