/**
 * BookingArchiveService
 *
 * Job quotidien : archive automatiquement les bookings dont la fenêtre planifiée
 * est terminée, sans dépendre d'une suppression de compte ni d'un backfill manuel.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ⚠️  CAVEAT LÉGAL — closedAt = availability.endAt                       │
 * │                                                                         │
 * │  `closedAt` représente la FIN DE LA FENÊTRE PLANIFIÉE du booking,       │
 * │  et NON la preuve que la prestation a été exécutée.                     │
 * │                                                                         │
 * │  Un no-show ou un report verbal sans annulation en app sont archivés    │
 * │  avec finalStatus = CONFIRMED et closedAt = endAt.                      │
 * │  Les bookings annulés via POST /bookings/:id/cancel sont archivés       │
 * │  avec finalStatus = CANCELLED_RIDER ou CANCELLED_PRO (statut réel en   │
 * │  base au moment où le job s'exécute).                                   │
 * │                                                                         │
 * │  L'archive prouve l'existence d'un engagement commercial,               │
 * │  pas son exécution, ni la présence des parties.                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Ce job est l'unique producteur de BookingLegalArchive.
 * Aucune archive immédiate n'est déclenchée depuis les endpoints d'annulation.
 */

import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';
import { archiveBookingIfNotExists, type BookingForArchive } from '../lib/booking-archive';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Max bookings loaded per Prisma query. Constant — not configurable. */
const BATCH_SIZE = 500;

/** Default grace period: days after endAt before a booking is eligible for archiving. */
export const DEFAULT_GRACE_DAYS = 14;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ArchiveJobResult {
  scanned: number;
  created: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class BookingArchiveService {
  /**
   * Archive les bookings dont `availability.endAt < now - graceDays`.
   *
   * ⚠️  Voir le CAVEAT module-level sur la sémantique de `closedAt`.
   *
   * Garanties :
   *  - Idempotent : un booking déjà archivé est compté `skipped`, jamais dupliqué.
   *  - Non-bloquant par item : une erreur individuelle est loggée et comptée,
   *    le batch continue.
   *  - Aucun userId / proUserId en clair dans les logs ni dans l'archive.
   *
   * @param graceDays  Jours de grâce après endAt (défaut : DEFAULT_GRACE_DAYS)
   * @returns          Compteurs pour observabilité
   */
  async archiveClosedBookings(graceDays = DEFAULT_GRACE_DAYS): Promise<ArchiveJobResult> {
    const startMs = Date.now();
    const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000);

    let scanned = 0;
    let created = 0;
    let skipped = 0;
    let errors = 0;
    let cursor: string | undefined;

    while (true) {
      // ── 1. Charger le batch (cursor-paginé, trié par id ASC) ─────────────
      const batch = await prisma.booking.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        where: { availability: { endAt: { lt: cutoff } } },
        include: {
          availability: {
            select: {
              proUserId: true,
              sport:     true,
              startAt:   true,
              endAt:     true,  // closedAt — voir CAVEAT
              price:     true,
            },
          },
        },
      });

      if (batch.length === 0) break;

      scanned += batch.length;
      cursor = batch[batch.length - 1].id;

      // ── 2. Pré-check batch : lesquels sont déjà archivés ? ───────────────
      //    Un seul SELECT IN au lieu de N findUnique individuels.
      //    archiveBookingIfNotExists reste le filet final (race condition safe).
      const existingArchives = await prisma.bookingLegalArchive.findMany({
        where: { bookingId: { in: batch.map((b: { id: string }) => b.id) } },
        select: { bookingId: true },
      });
      const archivedIds = new Set(existingArchives.map((a: { bookingId: string }) => a.bookingId));

      // ── 3. Archiver chaque item non encore archivé ───────────────────────
      for (const booking of batch) {
        if (archivedIds.has(booking.id)) {
          skipped++;
          continue;
        }

        // Defensive : la relation availability est chargée via include ; si elle
        // manque, le booking est dans un état incohérent → log + skip, ne jamais
        // lever d'exception pour un seul item.
        if (!booking.availability) {
          errors++;
          secureLogger.error('BOOKING_ARCHIVE_ITEM_ERROR', {
            bookingId: booking.id,
            error: 'availability relation absente — état incohérent',
          });
          continue;
        }

        try {
          // ⚠️  closedAt = availability.endAt (fin de fenêtre planifiée, pas preuve d'exécution)
          const result = await archiveBookingIfNotExists(
            booking as unknown as BookingForArchive,
            booking.availability.endAt,
          );
          if (result === 'created') {
            created++;
          } else {
            // 'skipped' : une autre instance a archivé entre le pré-check et maintenant
            skipped++;
          }
        } catch (err) {
          errors++;
          secureLogger.error('BOOKING_ARCHIVE_ITEM_ERROR', {
            bookingId: booking.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return {
      scanned,
      created,
      skipped,
      errors,
      durationMs: Date.now() - startMs,
    };
  }
}

export const bookingArchiveService = new BookingArchiveService();
