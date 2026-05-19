/**
 * booking-archive.ts
 *
 * Helper partagé pour la création de BookingLegalArchive.
 * Utilisé par :
 *   - gdpr-purge.service.ts (Phase 3 pre-deletion)
 *   - scripts/backfill-booking-legal-archive.ts
 *   - (futur) booking.service.ts si CANCELLED_* est implémenté
 *
 * Invariants :
 *   - Aucune PII directe archivée (userId remplacé par hash SHA-256 + salt)
 *   - Opération idempotente (upsert sur bookingId unique)
 *   - Aucune FK active vers User / Pro / ProAvailability
 */

import { createHash } from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types internes
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingForArchive {
  id: string;
  riderUserId: string;
  status: string;
  createdAt: Date;
  availability: {
    proUserId: string;
    sport: string;
    startAt: Date;
    price: { toNumber(): number } | null;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash stable et pseudonymisé
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produit un SHA-256 de `userId:salt` — non réversible.
 * Identique pour un même userId entre les runs (salt stable via env).
 *
 * NOTE : si ANONYMIZATION_SALT change en production, les hashes deviennent
 * incohérents avec les archives précédentes. Ne jamais changer la valeur
 * de cette variable sans migration de données.
 */
export function hashUserIdForArchive(userId: string): string {
  const salt = process.env.ANONYMIZATION_SALT ?? 'blobinfini-gdpr-salt';
  return createHash('sha256').update(`${userId}:${salt}`).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Calcul de purgeAt
// ─────────────────────────────────────────────────────────────────────────────

/** 10 ans après la date d'archivage — aligné sur Art. L123-22 Code de commerce. */
function computePurgeAt(archivedAt: Date): Date {
  const d = new Date(archivedAt);
  d.setFullYear(d.getFullYear() + 10);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonction d'archivage principale — idempotente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crée une entrée dans BookingLegalArchive si elle n'existe pas déjà.
 * Utilise un upsert sur bookingId (unique) → safe à rejouer.
 *
 * @param booking  Booking avec sa relation availability incluse
 * @param closedAt Moment de clôture (suppression compte ou annulation)
 * @returns        'created' | 'skipped'
 */
export async function archiveBookingIfNotExists(
  booking: BookingForArchive,
  closedAt: Date
): Promise<'created' | 'skipped'> {
  const existing = await prisma.bookingLegalArchive.findUnique({
    where: { bookingId: booking.id },
    select: { id: true },
  });

  if (existing) {
    return 'skipped';
  }

  const archivedAt = new Date();
  const purgeAt = computePurgeAt(archivedAt);

  // Conversion sécurisée du prix Decimal Prisma → number → Decimal string
  // On garde null si non renseigné — pas de fabrication de données.
  const priceDecimal =
    booking.availability.price != null
      ? booking.availability.price.toNumber()
      : null;

  await prisma.bookingLegalArchive.create({
    data: {
      bookingId:    booking.id,
      riderHash:    hashUserIdForArchive(booking.riderUserId),
      proHash:      hashUserIdForArchive(booking.availability.proUserId),
      sport:        booking.availability.sport as any, // enum Sport runtime-safe
      bookedAt:     booking.availability.startAt,
      createdAt:    booking.createdAt,
      closedAt,
      finalStatus:  booking.status,
      priceDecimal: priceDecimal !== null ? priceDecimal : undefined,
      archivedAt,
      purgeAt,
    },
  });

  return 'created';
}

// ─────────────────────────────────────────────────────────────────────────────
// Archivage en lot — pour Phase 3 pre-deletion et backfill
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkArchiveResult {
  created: number;
  skipped: number;
  errors: number;
}

/**
 * Archive un tableau de bookings, avec comptage des résultats.
 * Les erreurs sont loggées mais non bloquantes — on ne veut pas
 * qu'un booking corrompu empêche la suppression de compte.
 */
export async function archiveBookingsBulk(
  bookings: BookingForArchive[],
  closedAt: Date,
  context: string
): Promise<BulkArchiveResult> {
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const booking of bookings) {
    try {
      const result = await archiveBookingIfNotExists(booking, closedAt);
      if (result === 'created') created++;
      else skipped++;
    } catch (err) {
      errors++;
      secureLogger.error('BOOKING_ARCHIVE_FAILED', {
        context,
        bookingId: booking.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, skipped, errors };
}
