#!/usr/bin/env bash
set -euo pipefail

# Configure a minimal anonymous-read MinIO policy for public media prefixes.
# Default scope is pro profile photos only: pros/*.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.vps}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.blobsurf.yml}"
MC_IMAGE="${MC_IMAGE:-minio/mc:latest}"
ALIAS="${MINIO_ALIAS:-minio}"
PREFIXES="${PUBLIC_READ_PREFIXES:-pros/*}"
DRY_RUN=0
CLEAR_POLICY=0

usage() {
  cat <<'EOF'
Usage:
  scripts/minio-public-prefix-policy.sh [--dry-run] [--prefix pros/*]...
  scripts/minio-public-prefix-policy.sh [--dry-run] --clear

Environment:
  ENV_FILE       .env file to read S3 credentials from (default: .env.vps)
  COMPOSE_FILE   compose file that defines the MinIO network (default: docker-compose.blobsurf.yml)
  MC_IMAGE       MinIO Client image

Examples:
  scripts/minio-public-prefix-policy.sh --dry-run --prefix 'pros/*'
  scripts/minio-public-prefix-policy.sh --prefix 'pros/*'
  scripts/minio-public-prefix-policy.sh --clear

The script grants anonymous s3:GetObject only for the configured prefixes and
does not grant s3:ListBucket. It never deletes objects.
EOF
}

PREFIX_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --clear)
      CLEAR_POLICY=1
      PREFIX_ARGS=()
      shift
      ;;
    --prefix)
      [ "$#" -ge 2 ] || { echo "Missing value for --prefix" >&2; exit 2; }
      PREFIX_ARGS+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$CLEAR_POLICY" -eq 1 ] && [ "${#PREFIX_ARGS[@]}" -gt 0 ]; then
  echo "--clear cannot be combined with --prefix" >&2
  exit 2
fi

if [ "${#PREFIX_ARGS[@]}" -gt 0 ]; then
  PREFIXES="$(IFS=,; echo "${PREFIX_ARGS[*]}")"
fi

[ -f "$ENV_FILE" ] || { echo "Env file not found: $ENV_FILE" >&2; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "Compose file not found: $COMPOSE_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID missing}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY missing}"
: "${S3_BUCKET:?S3_BUCKET missing}"

case "$S3_BUCKET" in
  *[!A-Za-z0-9._-]*|'')
    echo "Unsafe S3_BUCKET value" >&2
    exit 1
    ;;
esac

RESOURCES=()
if [ "$CLEAR_POLICY" -eq 0 ]; then
  IFS=',' read -r -a PREFIX_ARRAY <<< "$PREFIXES"
  for raw_prefix in "${PREFIX_ARRAY[@]}"; do
    prefix="$(printf '%s' "$raw_prefix" | sed 's#^/##; s#//*#/#g')"
    [ -n "$prefix" ] || continue
    case "$prefix" in
      '*'|'/*'|*'..'*|*'?'*|*'['*|*']'*|*'%'*|*'\\'*)
        echo "Unsafe public prefix: $raw_prefix" >&2
        exit 1
        ;;
    esac
    RESOURCES+=("arn:aws:s3:::$S3_BUCKET/$prefix")
  done

  [ "${#RESOURCES[@]}" -gt 0 ] || { echo "No public prefixes configured" >&2; exit 1; }
fi

POLICY_TMPFILE="$(mktemp /tmp/minio-public-prefix-policy-XXXXXX.json)"
trap 'rm -f "$POLICY_TMPFILE"' EXIT

if [ "$CLEAR_POLICY" -eq 1 ]; then
  printf '{"Version":"2012-10-17","Statement":[]}' > "$POLICY_TMPFILE"
else
  {
    printf '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":['
    for i in "${!RESOURCES[@]}"; do
      [ "$i" -eq 0 ] || printf ','
      printf '"%s"' "${RESOURCES[$i]}"
    done
    printf ']}]}'
  } > "$POLICY_TMPFILE"
fi

echo "Bucket: $S3_BUCKET"
if [ "$CLEAR_POLICY" -eq 1 ]; then
  echo "Anonymous read prefixes: none"
else
  echo "Anonymous read prefixes:"
  for resource in "${RESOURCES[@]}"; do
    echo "  - ${resource#arn:aws:s3:::$S3_BUCKET/}"
  done
fi
echo "ListBucket: not granted"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry-run policy JSON:"
  sed 's/},{/},\n{/g' "$POLICY_TMPFILE"
  exit 0
fi

MINIO_CONTAINER="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q minio)"
[ -n "$MINIO_CONTAINER" ] || { echo "MinIO container not found" >&2; exit 1; }

NETWORK="$(docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$MINIO_CONTAINER" \
  | head -n 1)"
[ -n "$NETWORK" ] || { echo "MinIO Docker network not found" >&2; exit 1; }

MINIO_INT_URL="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000"

docker run --rm \
  --network "$NETWORK" \
  -e "MC_HOST_${ALIAS}=${MINIO_INT_URL}" \
  "$MC_IMAGE" \
  mb --ignore-existing "${ALIAS}/${S3_BUCKET}" >/dev/null

docker run --rm \
  --network "$NETWORK" \
  -e "MC_HOST_${ALIAS}=${MINIO_INT_URL}" \
  -v "${POLICY_TMPFILE}:/tmp/policy.json:ro" \
  "$MC_IMAGE" \
  anonymous set-json /tmp/policy.json "${ALIAS}/${S3_BUCKET}" >/dev/null

if [ "$CLEAR_POLICY" -eq 1 ]; then
  echo "Policy applied: anonymous public read cleared."
else
  echo "Policy applied: anonymous GetObject only for configured prefixes."
fi
