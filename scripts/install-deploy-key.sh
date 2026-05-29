#!/usr/bin/env bash
# scripts/install-deploy-key.sh — Installe la clé publique GitHub Actions dans authorized_keys
#
# À exécuter UNE FOIS après chaque provisioning VPS (bootstrap, recréation d'utilisateur, etc.)
# Idempotent : ne double pas la clé si elle est déjà présente.
#
# Usage :
#   ./scripts/install-deploy-key.sh
#   ./scripts/install-deploy-key.sh --user deploy  # si deploy != utilisateur courant
#
# La clé privée correspondante est dans le secret GitHub Actions VPS_SSH_KEY.
# Fingerprint : SHA256:kZPLL1/HMA6CIHy4D0UbdfKxT2otfyVEKpGM/LrkUZA (ED25519)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBKEY_FILE="$SCRIPT_DIR/github-actions-deploy.pub"

TARGET_USER="${USER}"
for arg in "$@"; do
  case "$arg" in
    --user) shift; TARGET_USER="${1:-$USER}" ;;
    --user=*) TARGET_USER="${arg#--user=}" ;;
  esac
done

TARGET_HOME=$(eval echo "~$TARGET_USER")
AUTH_KEYS="$TARGET_HOME/.ssh/authorized_keys"
PUBKEY=$(cat "$PUBKEY_FILE")
KEY_ID="github-actions-deploy@blobconnect"

if grep -qF "$KEY_ID" "$AUTH_KEYS" 2>/dev/null; then
  echo "Clé deploy GitHub Actions déjà présente dans $AUTH_KEYS — rien à faire."
  ssh-keygen -lf "$PUBKEY_FILE"
  exit 0
fi

install -m 700 -d "$TARGET_HOME/.ssh"
echo "$PUBKEY" >> "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

echo "Clé deploy GitHub Actions ajoutée dans $AUTH_KEYS"
echo "Fingerprint :"
ssh-keygen -lf "$PUBKEY_FILE"
