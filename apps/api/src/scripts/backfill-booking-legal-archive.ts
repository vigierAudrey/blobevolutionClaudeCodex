#!/usr/bin/env tsx
/**
 * backfill-booking-legal-archive.ts
 *
 * Archive les bookings existants qui n'ont pas encore d'entrée dans BookingLegalArchive.
 * Safe à relancer : skip automatique si l'archive existe déjà (findUnique avant insert).
 *
 * Usage :
 *   pnpm --filter @blobinfini/api exec tsx src/scripts/backfill-booking-legal-archive.ts
 *
 * Sortie :
 *   scanned  : nombre de bookings trouvés en base
 *   created  : nouvelles archives créées
 *   skipped  : déjà archivés (idempotence)
 *   errors   : échecs individuels (loggés, non bloquants)
 *
 * Hypothèses documentées :
 *   - Tous les bookings existants ont le statut CONFIRMED (CANCELLED_* non implémenté)
 *   - closedAt = maintenant (date d'exécution du backfill)
 *   - Si ProAvailability a déjà été supprimée (cas rare), le booking est introuvable → skippé
 *   - Batchs de 500 pour limiter la mémoire
 */

import { clientPrisma as prisma } from '@blobinfini/database';
import { archiveBookingIfNotExists } from '../lib/booking-archive';

const BATCH_SIZE = 500;

async function main() {
  console.log('=== Backfill BookingLegalArchive ===');
  console.log(`Démarrage : ${new Date().toISOString()}\n`);

  let scanned = 0;
  let created = 0;
  let skipped = 0;
  let errors = 0;
  let cursor: string | undefined = undefined;

  type BatchItem = Awaited<ReturnType<typeof prisma.booking.findMany<{
    include: { availability: { select: { proUserId: true; sport: true; startAt: true; price: true } } };
  }>>>[number];

  // Parcours paginé par cursor (UUID) — évite de charger tous les bookings en RAM
  while (true) {
    const batch: BatchItem[] = await prisma.booking.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        availability: {
          select: { proUserId: true, sport: true, startAt: true, price: true },
        },
      },
    });

    if (batch.length === 0) break;

    scanned += batch.length;
    cursor = batch[batch.length - 1].id;

    const closedAt = new Date(); // même timestamp pour tout le backfill

    for (const booking of batch) {
      try {
        const result = await archiveBookingIfNotExists(booking, closedAt);
        if (result === 'created') created++;
        else skipped++;
      } catch (err) {
        errors++;
        console.error(
          `  [ERREUR] booking ${booking.id} :`,
          err instanceof Error ? err.message : err
        );
      }
    }

    process.stdout.write(
      `  Batch terminé : ${scanned} scannés / ${created} créés / ${skipped} skippés / ${errors} erreurs\r`
    );
  }

  console.log('\n\n=== Résultat final ===');
  console.log(`  Scannés  : ${scanned}`);
  console.log(`  Créés    : ${created}`);
  console.log(`  Skippés  : ${skipped}`);
  console.log(`  Erreurs  : ${errors}`);
  console.log(`\nFin : ${new Date().toISOString()}`);

  if (errors > 0) {
    console.error(`\n⚠️  ${errors} booking(s) n'ont pas pu être archivés — vérifier les logs.`);
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
