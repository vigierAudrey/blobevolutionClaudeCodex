#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: bash scripts/free-port.sh <port> [other_ports...]" >&2
  exit 1
fi

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

is_listening() {
  local port="$1"

  if has_cmd ss; then
    ss -H -lnt "sport = :$port" 2>/dev/null | grep -q .
    return $?
  fi

  if has_cmd lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

collect_pids() {
  local port="$1"

  {
    if has_cmd lsof; then
      lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    fi

    if has_cmd ss; then
      ss -H -lntp "sport = :$port" 2>/dev/null \
        | grep -oE 'pid=[0-9]+' \
        | cut -d= -f2 \
        || true
    fi
  } | awk '/^[0-9]+$/' | sort -u
}

kill_port_once() {
  local port="$1"
  local pids

  if ! is_listening "$port"; then
    return 0
  fi

  pids="$(collect_pids "$port")"

  if [ -z "$pids" ] && has_cmd npx; then
    npx --yes kill-port "$port" >/dev/null 2>&1 || true
    pids="$(collect_pids "$port")"
  fi

  if [ -n "$pids" ]; then
    echo "$pids" | xargs -r kill -TERM 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      sleep 0.2
      if ! is_listening "$port"; then
        return 0
      fi
    done

    pids="$(collect_pids "$port")"
    if [ -n "$pids" ]; then
      echo "$pids" | xargs -r kill -KILL 2>/dev/null || true
    fi
  fi

  for _ in 1 2 3 4 5; do
    sleep 0.2
    if ! is_listening "$port"; then
      return 0
    fi
  done

  if is_listening "$port"; then
    echo "Port $port is still busy." >&2
    echo "Diagnostic: ss -lntp '( sport = :$port )'  |  lsof -nP -iTCP:$port -sTCP:LISTEN" >&2
    return 1
  fi
}

for port in "$@"; do
  kill_port_once "$port"
done
