#!/usr/bin/env bash
# scripts/setup-backup-keys.sh — Génération des clés de chiffrement backup (UNE SEULE FOIS)
#
# Génère une paire de clés age pour le chiffrement des backups :
#   - Clé PUBLIQUE  → stockée dans .env.vps (BACKUP_AGE_RECIPIENT=age1xxx...)
#   - Clé PRIVÉE    → JAMAIS sur le VPS, stockée hors-ligne (password manager, clé USB chiffrée)
#
# Principe de sécurité :
#   Le VPS ne chiffre qu'avec la clé publique — même root ne peut pas déchiffrer les backups.
#   En cas de ransomware, les backups R2 restent protégés.
#
# Usage :
#   ./scripts/setup-backup-keys.sh
#
# Après exécution :
#   1. Copier BACKUP_AGE_RECIPIENT=age1xxx... dans .env.vps
#   2. Stocker la clé privée dans votre password manager (Bitwarden, 1Password…)
#   3. NE JAMAIS copier la clé privée sur le VPS
#   4. Tester le chiffrement : echo "test" | age -r $(grep BACKUP_AGE_RECIPIENT .env.vps | cut -d= -f2) | age -d -i <keyfile>

set -euo pipefail
umask 077

# ─── GARDE-FOU VPS ────────────────────────────────────────────────────────────
# Ce script génère la clé PRIVÉE — exécuter UNIQUEMENT sur une machine locale.
# Si .env.vps est détecté avec APP_ENV=vps ou NODE_ENV=production, abort.
_candidate_env="/home/audrey/blob-app/.env.vps"
if [[ -f "$_candidate_env" ]]; then
  _app_env="$(grep -E '^APP_ENV=' "$_candidate_env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"
  _node_env="$(grep -E '^NODE_ENV=' "$_candidate_env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"
  if [[ "$_app_env" == "vps" || "$_node_env" == "production" ]]; then
    printf '\n' >&2
    printf '╔══════════════════════════════════════════════════════════════╗\n' >&2
    printf '║  ERREUR DE SÉCURITÉ : environnement VPS/production détecté  ║\n' >&2
    printf '║                                                              ║\n' >&2
    printf '║  Ce script génère la CLÉ PRIVÉE age. Il NE DOIT PAS         ║\n' >&2
    printf '║  être exécuté sur le VPS de production.                     ║\n' >&2
    printf '║                                                              ║\n' >&2
    printf '║  Procédure correcte :                                        ║\n' >&2
    printf '║  1. Exécuter sur votre machine locale (WSL/Linux/Mac)        ║\n' >&2
    printf '║  2. Copier UNIQUEMENT la clé publique dans .env.vps :        ║\n' >&2
    printf '║     BACKUP_AGE_RECIPIENT=age1xxx...                          ║\n' >&2
    printf '║  3. Stocker la clé privée dans votre password manager        ║\n' >&2
    printf '╚══════════════════════════════════════════════════════════════╝\n' >&2
    printf '\n' >&2
    exit 1
  fi
fi
unset _candidate_env _app_env _node_env

KEYFILE="${1:-$HOME/.age/blobsurf-backup.key}"

command -v age >/dev/null 2>&1 || {
  echo "ERROR: age non installé. Installer : sudo apt install age" >&2
  echo "       (Ubuntu 22.04+ / Debian 12+)" >&2
  exit 1
}
command -v age-keygen >/dev/null 2>&1 || {
  echo "ERROR: age-keygen non trouvé. Réinstaller age." >&2
  exit 1
}

if [[ -f "$KEYFILE" ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ATTENTION : un fichier de clé existe déjà : $KEYFILE"
  echo "║  Régénérer écrasera la clé existante — tous les backups"
  echo "║  chiffrés avec l'ancienne clé seront illisibles."
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  read -r -p "  Confirmer la régénération ? Taper YES pour continuer : " confirm
  [[ "$confirm" == "YES" ]] || { echo "Annulé."; exit 0; }
fi

mkdir -p "$(dirname "$KEYFILE")"
chmod 700 "$(dirname "$KEYFILE")"

# Générer la paire de clés
age-keygen -o "$KEYFILE" 2>/dev/null
chmod 600 "$KEYFILE"

PUBLIC_KEY="$(age-keygen -y "$KEYFILE" 2>/dev/null)"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              CLÉS GÉNÉRÉES — LIRE ATTENTIVEMENT             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Clé publique (BACKUP_AGE_RECIPIENT) :"
echo "  $PUBLIC_KEY"
echo ""
echo "  Clé privée : $KEYFILE"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ÉTAPE 1 — Ajouter dans .env.vps :"
echo "    BACKUP_AGE_RECIPIENT=$PUBLIC_KEY"
echo ""
echo "  ÉTAPE 2 — Sauvegarder la clé PRIVÉE hors VPS :"
echo "    cat $KEYFILE"
echo "    → Copier la sortie dans votre password manager (Bitwarden/1Password)"
echo "    → Copier aussi sur une clé USB chiffrée, gardée hors-ligne"
echo ""
echo "  ÉTAPE 3 — SUPPRIMER la clé privée du VPS (si ce n'est pas la machine de restore) :"
echo "    rm -f $KEYFILE"
echo ""
echo "  ÉTAPE 4 — Tester le chiffrement/déchiffrement :"
echo "    echo 'test-backup-2026' | age -r '$PUBLIC_KEY' | age -d -i $KEYFILE"
echo "    # Doit afficher : test-backup-2026"
echo ""
echo "  POUR RESTAURER un backup R2 :"
echo "    age -d -i /path/to/backup.key backup.sql.gz.age | gunzip | psql ..."
echo ""
echo "  IMPORTANT : Sans la clé privée, vos backups R2 sont IRRÉCUPÉRABLES."
echo "═══════════════════════════════════════════════════════════════"
