#!/usr/bin/env bash
# alert.sh — Canal d'alerte Discord pour les scripts ops BlobSurf (cron VPS)
#
# Sourcé par backup-encrypt-upload.sh, r2-restore-test.sh (et tout futur script
# ops) qui appellent :
#   send_alert <niveau> <message> [contexte]
#     niveau   : ok | warning | critical | emergency
#     message  : texte lisible humain — JAMAIS de secret, chemin sensible ou PII
#     contexte : identifiant court de l'événement (ex: r2-upload-failed)
#
# Contrat de robustesse :
#   - Ne fait JAMAIS échouer le script appelant (retourne toujours 0).
#   - Sans DISCORD_WEBHOOK_URL (ou sans curl) : dégrade en ligne de log locale.
#   - curl borné par timeout — un Discord injoignable ne bloque pas le cron.
#   - N'écrit jamais l'URL du webhook dans les logs (c'est un secret).
#
# Variables d'environnement (fournies par ENV_FILE sourcé par l'appelant) :
#   DISCORD_WEBHOOK_URL   URL du webhook Discord (requis pour l'envoi réel)
#   ALERT_MIN_LEVEL       Niveau minimal envoyé à Discord (défaut: ok = tout).
#                         Ex: ALERT_MIN_LEVEL=warning pour couper les "ok".
#   ALERT_HOSTNAME        Nom affiché dans l'alerte (défaut: hostname -s)
#
# Test manuel sur le VPS (n'envoie qu'une alerte de test) :
#   ENV_FILE=/home/audrey/blob-app/.env.vps bash scripts/alert.sh test

set -u

# ─── Niveaux ──────────────────────────────────────────────────────────────────
# Rang numérique pour le filtre ALERT_MIN_LEVEL + couleur d'embed Discord.
_alert_level_rank() {
  case "${1:-}" in
    ok)        echo 0 ;;
    warning)   echo 1 ;;
    critical)  echo 2 ;;
    emergency) echo 3 ;;
    *)         echo 1 ;;  # niveau inconnu → traité comme warning, jamais perdu
  esac
}

_alert_level_color() {
  case "${1:-}" in
    ok)        echo 3066993  ;;  # vert
    warning)   echo 16776960 ;;  # jaune
    critical)  echo 15158332 ;;  # rouge
    emergency) echo 10038562 ;;  # rouge sombre
    *)         echo 9807270  ;;  # gris
  esac
}

_alert_level_label() {
  case "${1:-}" in
    ok)        echo "✅ OK" ;;
    warning)   echo "⚠️ WARNING" ;;
    critical)  echo "🔴 CRITICAL" ;;
    emergency) echo "🚨 EMERGENCY" ;;
    *)         echo "⚠️ ${1:-UNKNOWN}" ;;
  esac
}

# Échappement minimal pour une chaîne JSON (les messages viennent de nos
# scripts, pas d'entrées utilisateur — backslash, quotes et sauts de ligne).
_alert_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n' ' ' | tr -d '\r'
}

_alert_log() {
  printf '%s [alert] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# ─── send_alert ───────────────────────────────────────────────────────────────
send_alert() {
  local level="${1:-warning}"
  local message="${2:-}"
  local context="${3:-}"

  # Trace locale systématique (même si Discord est configuré) — c'est la
  # source de vérité dans les logs cron.
  _alert_log "[${level}]${context:+ (${context})} ${message}"

  local webhook="${DISCORD_WEBHOOK_URL:-}"
  if [[ -z "$webhook" ]]; then
    _alert_log "DISCORD_WEBHOOK_URL absent — alerte non relayée (log local uniquement)."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    _alert_log "curl indisponible — alerte non relayée (log local uniquement)."
    return 0
  fi

  # Filtre de niveau (défaut: tout envoyer, y compris les "ok" quotidiens qui
  # servent de heartbeat — leur absence signale un cron mort).
  local min_level="${ALERT_MIN_LEVEL:-ok}"
  if [[ "$(_alert_level_rank "$level")" -lt "$(_alert_level_rank "$min_level")" ]]; then
    return 0
  fi

  local host="${ALERT_HOSTNAME:-$(hostname -s 2>/dev/null || echo blobsurf-vps)}"
  local title label color esc_msg esc_ctx payload
  label="$(_alert_level_label "$level")"
  color="$(_alert_level_color "$level")"
  esc_msg="$(_alert_json_escape "$message")"
  esc_ctx="$(_alert_json_escape "${context:-ops}")"
  title="$(_alert_json_escape "${label} — ${host}")"

  payload='{"embeds":[{"title":"'"$title"'","description":"'"$esc_msg"'","color":'"$color"',"footer":{"text":"'"$esc_ctx"' · '"$(date -u '+%Y-%m-%d %H:%M UTC')"'"}}]}'

  # Fire-and-forget borné. Échec réseau = log local, jamais d'échec propagé.
  # --fail pour détecter les 4xx/5xx Discord ; sortie curl silencieuse (aucun
  # risque d'écho de l'URL webhook dans les logs).
  if ! curl --silent --show-error --fail \
        --max-time 10 --retry 2 --retry-delay 2 \
        -H 'Content-Type: application/json' \
        -d "$payload" \
        "$webhook" >/dev/null 2>&1; then
    _alert_log "Envoi Discord échoué (réseau ou webhook invalide) — alerte conservée dans ce log."
  fi

  return 0
}

# ─── Mode test : `bash scripts/alert.sh test` ────────────────────────────────
# Exécuté directement (pas sourcé), envoie une alerte de validation.
if [[ "${BASH_SOURCE[0]}" == "${0}" && "${1:-}" == "test" ]]; then
  if [[ -n "${ENV_FILE:-}" && -f "${ENV_FILE}" ]]; then
    set -a; # shellcheck disable=SC1090
    source "${ENV_FILE}"; set +a
  fi
  send_alert ok "Alerte de test alert.sh — canal Discord opérationnel." "alert-self-test"
  _alert_log "Test terminé. Vérifier le salon Discord."
fi
