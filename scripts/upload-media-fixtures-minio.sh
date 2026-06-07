#!/usr/bin/env bash
set -euo pipefail

# Upload synthetic TEST/FIXTURE media to a local/test MinIO bucket, then verify
# the public/private storage invariants. This script never changes bucket policy.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
FIXTURE_ROOT="${FIXTURE_ROOT:-$ROOT_DIR/apps/api/fixtures/media}"
MC_IMAGE="${MC_IMAGE:-minio/mc:latest}"
ALIAS="fixtureminio"
CONFIRM_PRODUCTION_FIXTURES="${CONFIRM_PRODUCTION_FIXTURES:-}"

usage() {
  cat <<'EOF'
Usage:
  ENV_FILE=.env scripts/upload-media-fixtures-minio.sh

Environment:
  ENV_FILE       .env file containing S3_ENDPOINT, S3_ACCESS_KEY_ID,
                 S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_PUBLIC_URL_BASE.
  FIXTURE_ROOT   Fixture directory (default: apps/api/fixtures/media).

Safety:
  - Uploads only files named *test-fixture.webp.
  - Does not modify MinIO anonymous policy.
  - Refuses production-looking targets unless CONFIRM_PRODUCTION_FIXTURES is set
    to the exact value: TEST_FIXTURES_CONFIRMED_BY_HUMAN
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ ! -f "$ENV_FILE" ] && [ "$ENV_FILE" = "$ROOT_DIR/.env" ] && [ -f "$ROOT_DIR/.env.example" ]; then
  ENV_FILE="$ROOT_DIR/.env.example"
fi

[ -f "$ENV_FILE" ] || { echo "Env file not found: $ENV_FILE" >&2; exit 1; }
[ -d "$FIXTURE_ROOT/pros" ] || { echo "Missing fixtures directory: $FIXTURE_ROOT/pros" >&2; exit 1; }
[ -d "$FIXTURE_ROOT/users" ] || { echo "Missing fixtures directory: $FIXTURE_ROOT/users" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${S3_ENDPOINT:?S3_ENDPOINT missing}"
: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID missing}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY missing}"
: "${S3_BUCKET:?S3_BUCKET missing}"

case "$S3_BUCKET" in
  *[!A-Za-z0-9._-]*|'')
    echo "Unsafe S3_BUCKET value" >&2
    exit 1
    ;;
esac

PUBLIC_BASE="${S3_PUBLIC_URL_BASE:-${S3_ENDPOINT%/}/${S3_BUCKET}}"
PUBLIC_BASE="${PUBLIC_BASE%/}"

TARGET_FINGERPRINT="${APP_ENV:-} ${NODE_ENV:-} $ENV_FILE $S3_ENDPOINT $PUBLIC_BASE"
if printf '%s' "$TARGET_FINGERPRINT" | grep -Eiq 'production|prod|\.env\.vps|blobsurf\.com|blobinfini\.fr'; then
  if [ "$CONFIRM_PRODUCTION_FIXTURES" != "TEST_FIXTURES_CONFIRMED_BY_HUMAN" ]; then
    cat >&2 <<'EOF'
Refusing production-looking target.

These media are TEST/FIXTURE assets. Upload them to local/test MinIO only, or
set CONFIRM_PRODUCTION_FIXTURES=TEST_FIXTURES_CONFIRMED_BY_HUMAN after a human
has explicitly approved this exact production upload.
EOF
    exit 1
  fi
fi

MINIO_HOST_URL="$(
  S3_ENDPOINT="$S3_ENDPOINT" \
  S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  node - <<'NODE'
const endpoint = new URL(process.env.S3_ENDPOINT || '');
endpoint.username = process.env.S3_ACCESS_KEY_ID || '';
endpoint.password = process.env.S3_SECRET_ACCESS_KEY || '';
process.stdout.write(endpoint.toString());
NODE
)"

mc_cmd() {
  if command -v mc >/dev/null 2>&1; then
    MC_HOST_fixtureminio="$MINIO_HOST_URL" mc "$@"
    return
  fi

  command -v docker >/dev/null 2>&1 || {
    echo "Neither mc nor docker is available. Install MinIO Client or start Docker." >&2
    exit 1
  }

  local docker_args=()
  local arg
  for arg in "$@"; do
    case "$arg" in
      "$ROOT_DIR"/*)
        docker_args+=("/workspace/${arg#"$ROOT_DIR"/}")
        ;;
      *)
        docker_args+=("$arg")
        ;;
    esac
  done

  docker run --rm \
    --network host \
    -e "MC_HOST_fixtureminio=$MINIO_HOST_URL" \
    -v "$ROOT_DIR:/workspace:ro" \
    -w /workspace \
    "$MC_IMAGE" \
    "${docker_args[@]}"
}

content_type_from_stat() {
  node <<'NODE'
const raw = process.env.STAT_JSON || '';
  const parsed = JSON.parse(raw);
  const metadata = parsed.metadata || {};
  const candidates = [
    parsed.contentType,
    parsed.content_type,
    metadata['Content-Type'],
    metadata['content-type'],
    Array.isArray(metadata['Content-Type']) ? metadata['Content-Type'][0] : undefined,
    Array.isArray(metadata['content-type']) ? metadata['content-type'][0] : undefined,
  ].filter(value => typeof value === 'string' && value.length > 0);
  process.stdout.write(candidates[0] || '');
NODE
}

require_image_webp() {
  local file="$1"
  case "$file" in
    *test-fixture.webp) ;;
    *)
      echo "Refusing non-fixture media file: $file" >&2
      exit 1
      ;;
  esac

  local size
  size="$(wc -c < "$file" | tr -d ' ')"
  if [ "$size" -gt 307200 ]; then
    echo "Fixture exceeds 300 Ko: $file ($size bytes)" >&2
    exit 1
  fi
}

upload_fixture() {
  local local_path="$1"
  local key="$2"

  require_image_webp "$local_path"
  mc_cmd mb --ignore-existing "$ALIAS/$S3_BUCKET" >/dev/null
  mc_cmd cp --attr "Content-Type=image/webp" "$local_path" "$ALIAS/$S3_BUCKET/$key" >/dev/null

  local stat_json content_type
  stat_json="$(mc_cmd stat --json "$ALIAS/$S3_BUCKET/$key")"
  content_type="$(STAT_JSON="$stat_json" content_type_from_stat)"
  case "$content_type" in
    image/*) ;;
    *)
      echo "Unexpected Content-Type for $key: ${content_type:-missing}" >&2
      exit 1
      ;;
  esac
}

http_status() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "$url"
}

require_status() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local status

  status="$(http_status "$url")"
  if [ "$status" != "$expected" ]; then
    echo "$label expected HTTP $expected, got $status" >&2
    echo "URL: $url" >&2
    if [ "$label" = "pros/* anonymous GET" ] && [ "$status" = "403" ]; then
      echo "Hint: apply the pros-only public read policy in local/test, outside this script:" >&2
      echo "  ENV_FILE=$ENV_FILE scripts/minio-public-prefix-policy.sh --prefix 'pros/*'" >&2
      echo "Do not add --prefix 'users/*' for these fixtures." >&2
    fi
    exit 1
  fi
}

PRO_AVATAR_KEY="pros/test-fixtures/pro-avatar-test-fixture.webp"
PRO_COVER_KEY="pros/test-fixtures/pro-cover-test-fixture.webp"
PRO_GALLERY_KEY="pros/test-fixtures/pro-gallery-test-fixture.webp"
USER_AVATAR_KEY="users/test-fixtures/user-avatar-test-fixture.webp"
USER_COVER_KEY="users/test-fixtures/user-cover-test-fixture.webp"
USER_GALLERY_KEY="users/test-fixtures/user-gallery-test-fixture.webp"

upload_fixture "$FIXTURE_ROOT/pros/pro-avatar-test-fixture.webp" "$PRO_AVATAR_KEY"
upload_fixture "$FIXTURE_ROOT/pros/pro-cover-test-fixture.webp" "$PRO_COVER_KEY"
upload_fixture "$FIXTURE_ROOT/pros/pro-gallery-test-fixture.webp" "$PRO_GALLERY_KEY"
upload_fixture "$FIXTURE_ROOT/users/user-avatar-test-fixture.webp" "$USER_AVATAR_KEY"
upload_fixture "$FIXTURE_ROOT/users/user-cover-test-fixture.webp" "$USER_COVER_KEY"
upload_fixture "$FIXTURE_ROOT/users/user-gallery-test-fixture.webp" "$USER_GALLERY_KEY"

require_status "pros/* anonymous GET" "$PUBLIC_BASE/$PRO_AVATAR_KEY" "200"
require_status "users/* anonymous GET" "$PUBLIC_BASE/$USER_AVATAR_KEY" "403"
require_status "bucket listing" "$PUBLIC_BASE/?list-type=2" "403"

echo "Media fixtures uploaded and verified."
echo "Bucket: $S3_BUCKET"
echo "Public fixture: $PUBLIC_BASE/$PRO_AVATAR_KEY"
echo "Private rider fixture key: $USER_AVATAR_KEY"
