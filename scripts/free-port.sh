#!/usr/bin/env bash
set -euo pipefail

# Processus autorisés à être tués automatiquement (périmètre projet).
# Tout autre processus déclenche un WARNING et n'est pas tué.
# Note: /proc/pid/comm est tronqué à 15 chars par le kernel Linux —
# "next-server (v15.5.18)" devient "next-server (v1". On matche sur le préfixe.
SAFE_PATTERN="^(node|tsx|next|pnpm|npm|npx|bun)"

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# Retourne le nom court du processus (via /proc sur Linux, fallback ps).
get_cmd_name() {
  local pid="$1"
  if [ -r "/proc/$pid/comm" ]; then
    tr -d '\n' < "/proc/$pid/comm" 2>/dev/null || true
  else
    ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ' || true
  fi
}

# Retourne la ligne de commande complète (tronquée à 100 chars).
get_cmd_line() {
  local pid="$1"
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-100 || true
  else
    ps -p "$pid" -o args= 2>/dev/null | cut -c1-100 || true
  fi
}

is_safe() {
  local cmd="${1:-}"
  [[ "$cmd" =~ $SAFE_PATTERN ]] && return 0 || return 1
}

# Teste si un port TCP (IPv4 ou IPv6) est en écoute.
# Utilise grep au lieu du filtre ss (plus robuste sur toutes les versions iproute2/WSL2).
is_listening() {
  local port="$1"
  if has_cmd ss; then
    ss -lntp 2>/dev/null | grep -qE ":${port}[[:space:]]" && return 0 || true
  fi
  if has_cmd lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0 || true
  fi
  return 1
}

# Collecte les PIDs qui écoutent sur le port (IPv4 + IPv6), dédupliqués.
collect_pids() {
  local port="$1"
  {
    if has_cmd lsof; then
      lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    fi
    if has_cmd ss; then
      ss -lntp 2>/dev/null \
        | grep -E ":${port}[[:space:]]" \
        | grep -oE 'pid=[0-9]+' | cut -d= -f2 \
        || true
    fi
    if has_cmd fuser; then
      fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' || true
    fi
  } | grep -E '^[0-9]+$' | sort -u
}

# Envoie un signal à un PID après vérification du périmètre (mode safe).
send_signal() {
  local pid="$1" sig="$2" port="$3"
  local cmd_name cmd_line

  cmd_name="$(get_cmd_name "$pid")"
  cmd_line="$(get_cmd_line "$pid")"

  if is_safe "${cmd_name}"; then
    echo "[free-port] port ${port} — SIG${sig} PID ${pid} (${cmd_name}): ${cmd_line}" >&2
    kill "-${sig}" "$pid" 2>/dev/null || true
  else
    echo "[free-port] WARNING port ${port} — PID ${pid} (${cmd_name:-unknown}) n'est pas un processus node/pnpm — ignoré" >&2
    echo "[free-port]   cmdline : ${cmd_line:-?}" >&2
    echo "[free-port]   Si intentionnel : kill -${sig} ${pid}" >&2
  fi
}

kill_port_once() {
  local port="$1"
  local pids pid

  if ! is_listening "$port"; then
    echo "[free-port] port ${port} déjà libre." >&2
    return 0
  fi

  pids="$(collect_pids "$port")"

  if [ -z "$pids" ]; then
    echo "[free-port] WARNING port ${port} occupé mais aucun PID trouvé (problème de permissions ?)." >&2
    echo "  ss -ltnp | grep ':${port}'" >&2
    echo "  sudo lsof -nP -iTCP:${port} -sTCP:LISTEN" >&2
    return 1
  fi

  # Phase 1 : SIGTERM
  while IFS= read -r pid; do
    [ -n "$pid" ] && send_signal "$pid" "TERM" "$port"
  done <<< "$pids"

  for _ in 1 2 3 4 5; do
    sleep 0.2
    if ! is_listening "$port"; then
      echo "[free-port] port ${port} libéré." >&2
      return 0
    fi
  done

  # Phase 2 : SIGKILL pour les processus récalcitrants
  pids="$(collect_pids "$port")"
  if [ -n "$pids" ]; then
    echo "[free-port] port ${port} toujours occupé après SIGTERM — escalade SIGKILL" >&2
    while IFS= read -r pid; do
      [ -n "$pid" ] && send_signal "$pid" "KILL" "$port"
    done <<< "$pids"
  fi

  for _ in 1 2 3 4 5; do
    sleep 0.2
    if ! is_listening "$port"; then
      echo "[free-port] port ${port} libéré." >&2
      return 0
    fi
  done

  if is_listening "$port"; then
    echo "[free-port] ERREUR port ${port} toujours occupé après SIGKILL." >&2
    echo "  Diagnostic : ss -ltnp | grep ':${port}'" >&2
    echo "  Diagnostic : sudo lsof -nP -iTCP:${port} -sTCP:LISTEN" >&2
    return 1
  fi
}

if [ "$#" -lt 1 ]; then
  echo "Usage: bash scripts/free-port.sh <port> [other_ports...]" >&2
  exit 1
fi

for port in "$@"; do
  kill_port_once "$port"
done
