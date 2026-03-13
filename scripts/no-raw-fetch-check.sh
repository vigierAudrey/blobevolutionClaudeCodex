#!/usr/bin/env bash
# NO RAW FETCH GUARDRAIL
#
# Interdit les patterns `curl|bash` et `wget|sh` dans les fichiers CI/CD et scripts.
# Ces patterns permettent l'exécution de code arbitraire depuis une URL distante.
#
# Scanne: .github/workflows, .github/actions, scripts/
# Toléré: téléchargement curl → fichier, puis exécution séparée.
#
# Usage:
#   bash scripts/no-raw-fetch-check.sh
#   Exit 0 = OK, Exit 1 = violation détectée
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RAW_FETCH_HITS="$(
  find .github/workflows .github/actions scripts -type f \
    \( -name '*.yml' -o -name '*.yaml' -o -name '*.sh' \) \
    -print0 2>/dev/null \
    | xargs -0 -r grep -I -nE \
      '^[[:space:]]*(run:[[:space:]]*)?((curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z)?sh\b|bash[[:space:]]+<\([[:space:]]*(curl|wget)|sh[[:space:]]+<\([[:space:]]*(curl|wget))([[:space:];]|$)' \
    || true
)"

if [ -n "$RAW_FETCH_HITS" ]; then
  echo "❌ Raw remote fetch piped to a shell is forbidden."
  echo "$RAW_FETCH_HITS"
  exit 1
fi

echo "✅ no-raw-fetch-check: no curl|bash or wget|sh pattern detected in CI/shell scripts."
