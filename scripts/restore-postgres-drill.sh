#!/usr/bin/env bash
# scripts/restore-postgres-drill.sh — Restore drill PostgreSQL vers une base STAGING/TEMP désignée
#
# Restaure un dump PostgreSQL (.sql.gz / .sql) UNIQUEMENT vers une base temporaire
# explicitement fournie via RESTORE_TARGET_DATABASE_URL. Jamais vers la production.
#
# Modèle complémentaire de scripts/restore-pg.sh (qui restaure dans un conteneur
# Docker éphémère). Celui-ci cible une base PostgreSQL déjà existante (staging
# managé, instance temporaire, etc.) via une connection string.
#
# Usage :
#   RESTORE_TARGET_DATABASE_URL=postgresql://u:p@host:5432/blob_restore_drill \
#     ./scripts/restore-postgres-drill.sh <dump.sql.gz> [--dry-run] [--verify]
#   RESTORE_TARGET_DATABASE_URL=... ./scripts/restore-postgres-drill.sh --verify   # vérif seule
#
# Options :
#   --dry-run   Exécute TOUS les garde-fous + valide le dump, mais ne se connecte PAS
#               et ne restaure RIEN.
#   --verify    Vérifie la base cible (tables, _prisma_migrations). Combiné à un restore,
#               s'exécute après. Seul (sans dump), vérifie une base déjà restaurée.
#   --help|-h   Affiche cette aide.
#
# Variables d'environnement :
#   RESTORE_TARGET_DATABASE_URL  (REQUIS)  Cible du restore. Le nom de DB doit contenir
#                                          un marqueur sûr : restore|drill|staging|temp.
#   DATABASE_URL                 (optionnel) Si défini, REFUS de toute cible identique.
#   ALLOW_RESTORE_DRILL          (optionnel) Doit valoir "true" pour autoriser en NODE_ENV=production.
#   RESTORE_FORBIDDEN_HOSTS      (optionnel) Hôtes interdits supplémentaires (séparés par virgule).
#   RESTORE_MIN_BYTES            (défaut 1024) Taille minimale du dump (anti dump vide).
#   RESTORE_MIN_TABLES           (défaut 5) Nombre minimal de tables attendu (verify).
#
# Garde-fous anti-prod (le script REFUSE de tourner si) :
#   - RESTORE_TARGET_DATABASE_URL absent/vide ;
#   - cible identique à DATABASE_URL (chaîne OU tuple host:port/db) ;
#   - NODE_ENV=production sans ALLOW_RESTORE_DRILL=true ;
#   - host ou DB cible contient un motif prod (prod/production) ou figure dans la blocklist ;
#   - le nom de DB cible ne contient PAS de marqueur sûr (restore|drill|staging|temp).
#
# Sécurité : aucune connection string ni mot de passe dans les logs (basename only),
# mot de passe passé via PGPASSWORD (jamais en argument de commande), set -euo pipefail,
# umask 077, trap cleanup. Vérification read-only (COUNT / information_schema), jamais
# de SELECT * ni de dump de lignes utilisateur. Aucune dépendance externe (psql, gzip).
#
# INTERDIT ABSOLU : tout `prisma db push` destructif (perte de données) en prod /
# CI prod / deploy. Voir docs/ops/restore-drill.md.

set -euo pipefail
umask 077

DRY_RUN=false
DO_VERIFY=false
BACKUP_FILE=""

# Marqueurs autorisés dans le nom de la DB cible (insensible à la casse).
SAFE_MARKERS_REGEX='restore|drill|staging|temp'
# Motifs interdits dans le host ou le nom de DB (insensible à la casse).
FORBIDDEN_REGEX='prod|production'
RESTORE_MIN_BYTES="${RESTORE_MIN_BYTES:-1024}"
RESTORE_MIN_TABLES="${RESTORE_MIN_TABLES:-5}"

ts()  { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "$(ts) [restore-drill] $*"; }
die() { echo "$(ts) [restore-drill] ERREUR: $*" >&2; exit 1; }

# ─── Parse d'une connection string PostgreSQL (ne logge JAMAIS le résultat) ─────
# Renseigne les globals : DB_USER DB_PASS DB_HOST DB_PORT DB_NAME
PG_REGEX='^postgres(ql)?://([^:/@]+)(:([^@]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)(\?.*)?$'
parse_pg_url() {
  local url="$1"
  [[ "$url" =~ $PG_REGEX ]] || return 1
  DB_USER="${BASH_REMATCH[2]}"
  DB_PASS="${BASH_REMATCH[4]}"
  DB_HOST="${BASH_REMATCH[5]}"
  DB_PORT="${BASH_REMATCH[7]:-5432}"
  DB_NAME="${BASH_REMATCH[8]}"
  return 0
}

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# ─── Connexion à la cible via libpq (mot de passe hors ligne de commande) ───────
psql_target() {
  PGPASSWORD="$DB_PASS" psql --no-psqlrc --quiet "$@"
}

# ─── Vérification post-restore (read-only, aucune donnée perso) ─────────────────
verify_postgres_restore() {
  log "Vérification post-restore (read-only)..."

  # Connexion
  psql_target -c 'SELECT 1;' >/dev/null 2>&1 \
    || die "Connexion à la base cible impossible."

  # Nombre de tables dans public
  local table_count
  table_count="$(psql_target -tA -c \
    "SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE';")"
  table_count="$(printf '%s' "$table_count" | tr -d '[:space:]')"
  log "Tables (schéma public) : ${table_count}"
  (( table_count >= RESTORE_MIN_TABLES )) \
    || die "Seulement ${table_count} table(s) (< ${RESTORE_MIN_TABLES}) — restore vide/incomplet."

  # Cohérence migrations Prisma (présence + dernière migration appliquée).
  # migration_name est une métadonnée de schéma, pas une donnée personnelle.
  local has_migs
  has_migs="$(psql_target -tA -c \
    "SELECT to_regclass('public._prisma_migrations') IS NOT NULL;")"
  has_migs="$(printf '%s' "$has_migs" | tr -d '[:space:]')"
  if [[ "$has_migs" == "t" ]]; then
    local mig_count last_mig
    mig_count="$(psql_target -tA -c \
      "SELECT COUNT(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL;")"
    mig_count="$(printf '%s' "$mig_count" | tr -d '[:space:]')"
    last_mig="$(psql_target -tA -c \
      "SELECT migration_name FROM public._prisma_migrations
       WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;")"
    last_mig="$(printf '%s' "$last_mig" | tr -d '[:space:]')"
    log "_prisma_migrations : ${mig_count} migration(s) appliquée(s), dernière=${last_mig:-aucune}"
  else
    log "Avertissement : table _prisma_migrations absente (schéma non géré par Prisma ?)."
  fi

  log "Vérification post-restore : OK"
}

# ─── Parsing des arguments ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --verify)  DO_VERIFY=true; shift ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0 ;;
    -*) die "Option inconnue." ;;   # message neutre : pas d'écho de l'argument
    *)
      [[ -z "$BACKUP_FILE" ]] || die "Un seul fichier de dump est accepté."
      BACKUP_FILE="$1"; shift ;;
  esac
done

# ─── 0. Outils requis ──────────────────────────────────────────────────────────
# gzip est nécessaire dès le dry-run (validation d'intégrité du dump).
# psql n'est exigé qu'avant la connexion réelle (cf. section 10) : un dry-run
# doit pouvoir tourner sur une machine sans client PostgreSQL.
command -v gzip >/dev/null 2>&1 || die "gzip introuvable dans PATH."

log "=== Restore drill PostgreSQL (cible staging/temp désignée) ==="
$DRY_RUN && log "Mode : DRY-RUN (aucune connexion, aucune écriture)"

# ─── 1. Cible explicite obligatoire ────────────────────────────────────────────
TARGET_URL="${RESTORE_TARGET_DATABASE_URL:-}"
[[ -n "$TARGET_URL" ]] \
  || die "RESTORE_TARGET_DATABASE_URL est requis (cible staging/temp). DATABASE_URL n'est JAMAIS utilisé par défaut."

# ─── 2. Refus si cible == DATABASE_URL (chaîne exacte) ─────────────────────────
if [[ -n "${DATABASE_URL:-}" && "$TARGET_URL" == "$DATABASE_URL" ]]; then
  die "Cible identique à DATABASE_URL — restore refusé (risque production)."
fi

# ─── 3. Parse de la cible ──────────────────────────────────────────────────────
parse_pg_url "$TARGET_URL" \
  || die "RESTORE_TARGET_DATABASE_URL n'est pas une URL postgres valide."
TARGET_USER="$DB_USER"; TARGET_PASS="$DB_PASS"; TARGET_HOST="$DB_HOST"
TARGET_PORT="$DB_PORT"; TARGET_NAME="$DB_NAME"
HOST_LC="$(lc "$TARGET_HOST")"
NAME_LC="$(lc "$TARGET_NAME")"

# ─── 3b. Refus si tuple host:port/db == DATABASE_URL ───────────────────────────
if [[ -n "${DATABASE_URL:-}" ]] && parse_pg_url "$DATABASE_URL"; then
  if [[ "$HOST_LC:$TARGET_PORT/$NAME_LC" == "$(lc "$DB_HOST"):$DB_PORT/$(lc "$DB_NAME")" ]]; then
    die "Cible (host:port/db) identique à DATABASE_URL — restore refusé."
  fi
fi
# Restaurer les variables de connexion cible (écrasées par le parse de DATABASE_URL)
DB_USER="$TARGET_USER"; DB_PASS="$TARGET_PASS"; DB_HOST="$TARGET_HOST"
DB_PORT="$TARGET_PORT"; DB_NAME="$TARGET_NAME"

# ─── 4. Garde-fou NODE_ENV=production ──────────────────────────────────────────
if [[ "${NODE_ENV:-}" == "production" && "${ALLOW_RESTORE_DRILL:-}" != "true" ]]; then
  die "NODE_ENV=production sans ALLOW_RESTORE_DRILL=true — restore refusé."
fi

# ─── 5. Blocklist host/db (motifs prod + RESTORE_FORBIDDEN_HOSTS) ──────────────
if [[ "$HOST_LC" =~ $FORBIDDEN_REGEX || "$NAME_LC" =~ $FORBIDDEN_REGEX ]]; then
  die "Host ou nom de DB cible contient un motif interdit (prod/production) — restore refusé."
fi
if [[ -n "${RESTORE_FORBIDDEN_HOSTS:-}" ]]; then
  IFS=',' read -ra _forbidden <<< "$RESTORE_FORBIDDEN_HOSTS"
  for h in "${_forbidden[@]}"; do
    h_lc="$(lc "$h" | tr -d '[:space:]')"
    [[ -z "$h_lc" ]] && continue
    [[ "$HOST_LC" == "$h_lc" ]] \
      && die "Host cible figure dans RESTORE_FORBIDDEN_HOSTS — restore refusé."
  done
fi

# ─── 6. Marqueur sûr obligatoire dans le nom de DB ─────────────────────────────
[[ "$NAME_LC" =~ $SAFE_MARKERS_REGEX ]] \
  || die "Le nom de DB cible ne contient aucun marqueur sûr ($SAFE_MARKERS_REGEX) — restore refusé."

# Host masqué dans les logs (jamais la connection string complète)
log "Cible validée : db=$DB_NAME (marqueur sûr OK, non-prod)"

# ─── 7. Détermination de l'action ──────────────────────────────────────────────
WILL_RESTORE=false
if [[ -n "$BACKUP_FILE" ]]; then
  WILL_RESTORE=true
fi
if ! $DRY_RUN && ! $WILL_RESTORE && ! $DO_VERIFY; then
  die "Rien à faire : fournir un dump à restaurer, ou --verify, ou --dry-run."
fi

# ─── 8. Validation du dump (si un dump est fourni) ─────────────────────────────
BACKUP_ABS=""; BACKUP_BASE=""; IS_GZIP=false
if $WILL_RESTORE || ( $DRY_RUN && [[ -n "$BACKUP_FILE" ]] ); then
  [[ -f "$BACKUP_FILE" ]] || die "Fichier de dump introuvable."
  BACKUP_ABS="$(realpath "$BACKUP_FILE")"
  BACKUP_BASE="$(basename "$BACKUP_ABS")"
  case "$BACKUP_BASE" in
    *.sql.gz) IS_GZIP=true ;;
    *.sql)    IS_GZIP=false ;;
    *) die "Extension inattendue (.sql.gz ou .sql requis)." ;;
  esac
  local_size="$(wc -c < "$BACKUP_ABS")"
  (( local_size >= RESTORE_MIN_BYTES )) \
    || die "Dump trop petit/vide (${local_size} octets < ${RESTORE_MIN_BYTES}) : $BACKUP_BASE"
  if $IS_GZIP; then
    gzip --test "$BACKUP_ABS" 2>/dev/null \
      || die "Dump gzip corrompu (intégrité échouée) : $BACKUP_BASE"
  fi
  log "Dump validé : $BACKUP_BASE (${local_size} octets, intégrité OK)"
elif $DRY_RUN; then
  die "DRY-RUN nécessite un dump à valider, ou utilisez --verify pour une base existante."
fi

# ─── 9. Dry-run : on s'arrête avant toute connexion ────────────────────────────
if $DRY_RUN; then
  log "DRY-RUN : garde-fous + dump OK. Aucune connexion, aucun restore."
  exit 0
fi

# ─── 10. Connexion : variables libpq ───────────────────────────────────────────
command -v psql >/dev/null 2>&1 || die "psql introuvable dans PATH (requis pour le restore/verify)."
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGDATABASE="$DB_NAME"

# ─── 11. Restore (si un dump est fourni) ───────────────────────────────────────
if $WILL_RESTORE; then
  log "Restore en cours vers la base '$DB_NAME'..."
  RESTORE_ERRORS="$(mktemp)"
  trap 'rm -f "$RESTORE_ERRORS"' EXIT

  # -o /dev/null : la sortie de psql (set_config/setval/etc.) est jetée — aucune
  # ligne de données ne transite par les logs ; seul stderr est conservé.
  if $IS_GZIP; then
    gunzip -c "$BACKUP_ABS" | psql_target -v ON_ERROR_STOP=0 -o /dev/null 2>"$RESTORE_ERRORS" || true
  else
    psql_target -v ON_ERROR_STOP=0 -o /dev/null -f "$BACKUP_ABS" 2>"$RESTORE_ERRORS" || true
  fi

  # grep -c imprime toujours un nombre (0 si aucune correspondance) puis sort 1 :
  # `|| true` évite la double sortie de `|| echo 0`.
  FATAL="$(grep -c '^ERROR:' "$RESTORE_ERRORS" 2>/dev/null || true)"
  IGNORABLE="$(grep -c 'already exists' "$RESTORE_ERRORS" 2>/dev/null || true)"
  FATAL="${FATAL:-0}"; IGNORABLE="${IGNORABLE:-0}"
  FATAL=$(( FATAL - IGNORABLE ))
  (( FATAL < 0 )) && FATAL=0
  rm -f "$RESTORE_ERRORS"
  trap - EXIT

  if (( FATAL > 0 )); then
    log "Avertissement : $FATAL erreur(s) non-ignorable(s) durant le restore (schéma à investiguer)."
  else
    log "Restore terminé sans erreur fatale."
  fi
fi

# ─── 12. Vérification post-restore ─────────────────────────────────────────────
if $DO_VERIFY; then
  verify_postgres_restore
fi

log "=== Restore drill terminé ==="
