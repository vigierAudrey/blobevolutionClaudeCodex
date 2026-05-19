#!/usr/bin/env bash
# check-booking-status-mutations.sh
#
# Filet CI LÉGER et COMPLÉMENTAIRE — ne remplace pas la revue de code.
# Détecte les glissements naïfs les plus courants :
#   - booking.update() avec status: en dehors de cancelBookingInTx
#   - adjustBookedCount accessible au PRO
#   - réintroduction de POST /bookings/manual (capacité admin supprimée, décision produit)
#
# Bypassable par renommage de méthode ou reformulation du code.
# La vraie protection est : cancelBookingInTx comme point unique + tests e2e + revue PR.

set -euo pipefail

ERRORS=0

# ── 1. booking.update avec status: hors de cancelBookingInTx ──────────────────
# Cherche tout appel tx.booking.update ou prisma.booking.update contenant "status:"
# dans booking.service.ts, hors du contexte de cancelBookingInTx.
# Stratégie : on cherche "booking.update" + "status" dans le fichier,
# puis on vérifie que seul cancelBookingInTx en est la source.

SERVICE="apps/api/src/modules/booking/booking.service.ts"

if [ ! -f "$SERVICE" ]; then
  echo "⚠️  SKIP: $SERVICE not found — booking module removed (product decision 2026-03). Guard not applicable."
  exit 0
fi

# Extraire les lignes contenant booking.update avec status (hors commentaires)
VIOLATIONS=$(grep -n "\.booking\.update" "$SERVICE" \
  | grep "status" \
  | grep -v "^\s*//" \
  | grep -v "cancelBookingInTx\|// allowed-booking-status-update" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ booking.update with status: found outside cancelBookingInTx:"
  echo "$VIOLATIONS"
  echo ""
  echo "   All Booking.status mutations must go through cancelBookingInTx()."
  echo "   If this is intentional, add '// allowed-booking-status-update' comment."
  ERRORS=$((ERRORS + 1))
fi

# ── 2. adjustBookedCount accessible au PRO ────────────────────────────────────
CONTROLLER="apps/api/src/modules/booking/booking.controller.ts"

if [ ! -f "$CONTROLLER" ]; then
  echo "⚠️  SKIP: $CONTROLLER not found — booking module removed (product decision 2026-03). Guard not applicable."
  exit 0
fi

# Cherche ensureRole('PRO') sur la même ligne ou les 3 lignes précédant adjust-booked
ADJ_PRO=$(grep -n "adjust-booked" "$CONTROLLER" | head -1 | cut -d: -f1 || true)
if [ -n "$ADJ_PRO" ]; then
  CONTEXT=$(sed -n "$((ADJ_PRO > 5 ? ADJ_PRO - 5 : 1)),${ADJ_PRO}p" "$CONTROLLER")
  if echo "$CONTEXT" | grep -q "ensureRole('PRO')"; then
    echo "❌ adjustBookedCount is accessible to PRO role — must be ADMIN only"
    ERRORS=$((ERRORS + 1))
  fi
fi

# ── 3. POST /bookings/manual ne doit plus exister (décision produit 2026-03-24) ─
# La capacité de création manuelle admin a été supprimée.
# Si elle réapparaît dans le controller, le CI échoue.
MAN_LINE=$(grep -n "bookings/manual" "$CONTROLLER" | head -1 | cut -d: -f1 || true)
if [ -n "$MAN_LINE" ]; then
  echo "❌ POST /bookings/manual found in controller — this route was removed (product decision: no admin manual booking)"
  echo "   Line: $MAN_LINE"
  ERRORS=$((ERRORS + 1))
fi

# ── Résultat ─────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "❌ $ERRORS booking guard violation(s) detected."
  echo "   This is a lightweight grep check — confirm with code review."
  exit 1
fi

echo "✅ booking-status-mutations check passed (lightweight grep guard)"
