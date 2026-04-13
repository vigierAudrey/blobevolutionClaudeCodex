/**
 * backfill-booking-legal-archive.ts
 *
 * Garantit que 100% des Booking ont une entrée BookingLegalArchive.
 * Condition de passage obligatoire avant toute migration destructive.
 *
 * ── STRATÉGIE ANTI-TOCTOU ──────────────────────────────────────────────────
 *
 * Problème : gdpr-purge.service.ts (phase 3) peut tourner en parallèle et
 * archiver le même booking que ce script.
 *
 * Solution : archiveBookingIfNotExists() utilise un upsert Prisma sur
 * bookingId (contrainte UNIQUE en base). En cas de course :
 *   - Si gdpr-purge archive en premier → ce script lit "existing = found" → 'skipped'
 *   - Si ce script archive en premier  → gdpr-purge lit "existing = found" → 'skipped'
 *   - Jamais de doublon grâce à la contrainte unique(bookingId)
 *
 * NB : archiveBookingIfNotExists utilise findUnique + create (pas upsert Prisma natif).
 * Race condition résiduelle possible entre findUnique et create :
 *   → Le create échoue avec P2002 (unique constraint) si gdpr-purge a créé entre-temps.
 *   → Ce cas est géré dans la boucle principale (catch P2002 → skipped, pas error).
 *
 * ── IDEMPOTENCE ───────────────────────────────────────────────────────────
 *
 * Le script peut être relancé N fois sans dommage :
 *   - Les bookings déjà archivés sont 'skipped' (pas recréés)
 *   - La vérification finale contrôle missingArchives = 0
 *
 * ── ORPHELINS ──────────────────────────────────────────────────────────────
 *
 * Un orphan = Booking dont availability a été supprimée hors cascade normale.
 * Ces bookings sont loggés et comptés séparément — ils bloquent le passage
 * si en dehors des cas attendus (FK Cascade devrait les empêcher).
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *
 *   # Vérification seule (ne modifie rien) :
 *   pnpm --filter @blobinfini/api backfill:booking-archive:verify
 *
 *   # Dry-run (comptage, pas d'écriture) :
 *   pnpm --filter @blobinfini/api backfill:booking-archive
 *
 *   # Exécution réelle :
 *   pnpm --filter @blobinfini/api backfill:booking-archive:execute
 */

import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { archiveBookingIfNotExists } from '../lib/booking-archive';
import { secureLogger } from '../utils/secure-logger';

function getPrismaCode(err: unknown): string | undefined {
  if (err != null && typeof err === 'object' && 'code' in err) {
    const code = (err as Record<string, unknown>).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

const MODE = process.argv.includes('--execute')
  ? 'execute'
  : process.argv.includes('--verify')
    ? 'verify'
    : 'dry-run';

const BATCH_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Types internes
// ─────────────────────────────────────────────────────────────────────────────

interface IntegrityReport {
  totalBookings: number;
  archivedBookings: number;
  missingArchives: number;
  duplicateArchives: number;
  orphanBookings: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vérification d'intégrité — lecture seule, safe à exécuter à tout moment
// ─────────────────────────────────────────────────────────────────────────────

async function verifyIntegrity(): Promise<IntegrityReport> {
  // Nombre total de bookings
  const totalBookings = await prisma.booking.count();

  // Bookings manquant dans l'archive
  type CountRow = { cnt: bigint };

  const [missingRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(b.id)::bigint AS cnt
    FROM "Booking" b
    LEFT JOIN "BookingLegalArchive" bla ON bla."bookingId" = b.id
    WHERE bla.id IS NULL
  `;
  const missingArchives = Number(missingRow?.cnt ?? 0);

  // Archives présentes
  const archivedBookings = totalBookings - missingArchives;

  // Doublons (violation de la contrainte unique — ne devrait jamais arriver)
  const [dupRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS cnt
    FROM (
      SELECT "bookingId"
      FROM "BookingLegalArchive"
      GROUP BY "bookingId"
      HAVING COUNT(*) > 1
    ) sub
  `;
  const duplicateArchives = Number(dupRow?.cnt ?? 0);

  // Orphelins : bookings dont l'availability n'existe plus
  // (Normalement impossible via CASCADE, mais on vérifie)
  const [orphanRow] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(b.id)::bigint AS cnt
    FROM "Booking" b
    LEFT JOIN "ProAvailability" pa ON pa.id = b."availabilityId"
    WHERE pa.id IS NULL
  `;
  const orphanBookings = Number(orphanRow?.cnt ?? 0);

  return {
    totalBookings,
    archivedBookings,
    missingArchives,
    duplicateArchives,
    orphanBookings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill principal
// ─────────────────────────────────────────────────────────────────────────────

async function runBackfill(): Promise<void> {
  const dryRun = MODE === 'dry-run';

  console.log(`\n=== Backfill BookingLegalArchive [${MODE.toUpperCase()}] ===`);
  console.log(`Timestamp : ${new Date().toISOString()}\n`);

  // ── Vérification pré-backfill ─────────────────────────────────────────────

  const pre = await verifyIntegrity();
  console.log('Rapport pré-backfill :');
  console.log(`  totalBookings     = ${pre.totalBookings}`);
  console.log(`  archivedBookings  = ${pre.archivedBookings}`);
  console.log(`  missingArchives   = ${pre.missingArchives}`);
  console.log(`  duplicateArchives = ${pre.duplicateArchives}`);
  console.log(`  orphanBookings    = ${pre.orphanBookings}`);

  // Bloquant : doublons indiquent une corruption de l'archive
  if (pre.duplicateArchives > 0) {
    console.error('\n❌ ABORT : doublons détectés dans BookingLegalArchive.');
    console.error('   L\'intégrité de l\'archive est compromise. Investigation requise.');
    process.exit(2);
  }

  // Bloquant : orphelins inattendus (CASCADE devrait les éliminer)
  if (pre.orphanBookings > 0) {
    console.error(`\n❌ ABORT : ${pre.orphanBookings} booking(s) orphelin(s) détecté(s) (availability supprimée hors cascade).`);
    console.error('   Investigation requise avant de continuer.');
    process.exit(3);
  }

  if (pre.missingArchives === 0) {
    console.log('\n✅ Aucun booking manquant — backfill non nécessaire.');
    console.log('   Condition de passage Phase 2 : VALIDÉE');
    return;
  }

  console.log(`\n⚠️  ${pre.missingArchives} booking(s) sans archive légale.`);

  if (dryRun) {
    console.log('\n[DRY-RUN] Aucune modification effectuée.');
    console.log('   Relancer avec --execute pour appliquer le backfill.');
    return;
  }

  // ── Backfill en batches (cursor pagination sur ID) ───────────────────────

  let processedTotal = 0;
  let createdTotal = 0;
  let skippedTotal = 0;
  let errorTotal = 0;
  let cursor: string | undefined = undefined;
  const errorBookingIds: string[] = [];

  for (;;) {
    // Pagination cursor : stable même si des lignes sont créées/modifiées en cours
    // Filtre SQL direct pour ne récupérer que les bookings sans archive :
    // Prisma ne supporte pas NOT EXISTS natif, on utilise un cursor + filtre JS.
    // Le volume de bookings est borné (module mort → plus de création) donc
    // cette approche est acceptable. Pour des millions de lignes, utiliser $queryRaw.

    const whereClause: Prisma.BookingWhereInput = cursor ? { id: { gt: cursor } } : {};
    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        availability: {
          select: {
            proUserId: true,
            sport: true,
            startAt: true,
            price: true,
          },
        },
      },
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });

    if (bookings.length === 0) break;

    cursor = bookings[bookings.length - 1].id;

    for (const booking of bookings) {
      // Skip rapide si déjà archivé (évite l'appel async inutile)
      // Note : archiveBookingIfNotExists fait un findUnique interne,
      // mais on préfère un check rapide ici pour les bookings déjà archivés.
      const alreadyArchived = await prisma.bookingLegalArchive.findUnique({
        where: { bookingId: booking.id },
        select: { id: true },
      });
      if (alreadyArchived) {
        skippedTotal++;
        processedTotal++;
        continue;
      }

      if (!booking.availability) {
        // Orphelin non détecté par le check initial (race improbable)
        secureLogger.error('BACKFILL_ORPHAN_BOOKING_DETECTED', {
          bookingId: booking.id,
        });
        errorBookingIds.push(booking.id);
        errorTotal++;
        processedTotal++;
        continue;
      }

      try {
        const closedAt = booking.cancelledAt ?? booking.createdAt;
        const result = await archiveBookingIfNotExists(
          {
            id: booking.id,
            riderUserId: booking.riderUserId,
            status: booking.status,
            createdAt: booking.createdAt,
            availability: booking.availability,
          },
          closedAt,
        );

        if (result === 'created') createdTotal++;
        else skippedTotal++;

      } catch (err) {
        // P2002 = race avec gdpr-purge qui a archivé entre notre findUnique et le create
        // C'est idempotent : le booking EST archivé, on comptabilise en skipped
        if (getPrismaCode(err) === 'P2002') {
          skippedTotal++;
          secureLogger.info('BACKFILL_RACE_CONDITION_RESOLVED', {
            bookingId: booking.id,
            resolution: 'P2002 on create — concurrent archive detected, treated as skipped',
          });
        } else {
          errorTotal++;
          errorBookingIds.push(booking.id);
          secureLogger.error('BACKFILL_ARCHIVE_FAILED', {
            bookingId: booking.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      processedTotal++;
    }

    console.log(
      `  Batch : processed=${processedTotal}  created=${createdTotal}  ` +
      `skipped=${skippedTotal}  errors=${errorTotal}`,
    );
  }

  // ── Vérification post-backfill ────────────────────────────────────────────

  console.log('\nRapport post-backfill :');
  const post = await verifyIntegrity();
  console.log(`  totalBookings     = ${post.totalBookings}`);
  console.log(`  archivedBookings  = ${post.archivedBookings}`);
  console.log(`  missingArchives   = ${post.missingArchives}`);
  console.log(`  duplicateArchives = ${post.duplicateArchives}`);
  console.log(`  orphanBookings    = ${post.orphanBookings}`);

  if (post.duplicateArchives > 0) {
    console.error('\n❌ ÉCHEC CRITIQUE : doublons introduits lors du backfill.');
    console.error('   Intégrité compromise. Ne PAS procéder à la suppression des tables.');
    process.exit(4);
  }

  if (post.missingArchives > 0) {
    console.error(`\n❌ ÉCHEC : ${post.missingArchives} booking(s) toujours sans archive.`);
    if (errorBookingIds.length > 0) {
      console.error(`   IDs en erreur : ${errorBookingIds.slice(0, 10).join(', ')}${errorBookingIds.length > 10 ? '...' : ''}`);
    }
    console.error('   NE PAS procéder à la suppression des tables booking.');
    process.exit(5);
  }

  console.log('\n✅ Backfill terminé avec succès.');
  console.log(`   Créés: ${createdTotal}  |  Skipped: ${skippedTotal}  |  Erreurs: ${errorTotal}`);
  console.log('\n→ Condition de passage Phase 2 : VALIDÉE');
  console.log(`→ Timestamp de validation : ${new Date().toISOString()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  try {
    if (MODE === 'verify') {
      console.log('\n=== Vérification BookingLegalArchive [VERIFY-ONLY] ===');
      console.log(`Timestamp : ${new Date().toISOString()}\n`);

      const report = await verifyIntegrity();
      console.log('Rapport d\'intégrité :');
      console.log(JSON.stringify(report, null, 2));

      const pass =
        report.missingArchives === 0 &&
        report.duplicateArchives === 0 &&
        report.orphanBookings === 0;

      console.log(pass ? '\n✅ PASS — Intégrité confirmée.' : '\n❌ FAIL — Problèmes détectés.');
      process.exit(pass ? 0 : 1);
    } else {
      await runBackfill();
    }
  } catch (err) {
    console.error('Erreur non gérée :', err);
    process.exit(99);
  } finally {
    await prisma.$disconnect();
  }
})();
