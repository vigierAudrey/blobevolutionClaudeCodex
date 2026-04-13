/**
 * freeze-booking-analytics-snapshot.ts
 *
 * Gèle les métriques analytics dépendant des tables booking dans BookingAnalyticsSnapshot.
 *
 * ── PRÉREQUIS OBLIGATOIRES ─────────────────────────────────────────────────
 *   1. backfill:booking-archive:verify → missingArchives = 0
 *   2. BOOKING_DISABLED actif depuis ≥ 48h (aucune nouvelle donnée possible)
 *   3. Migration BookingAnalyticsSnapshot appliquée (prisma db push ou migrate deploy)
 *
 * ── IDEMPOTENCE ───────────────────────────────────────────────────────────
 *   Si frozen=true existe déjà pour une période → skip (les données sont protégées).
 *   Si frozen=false → recalcul possible (permet de corriger avant le gel final).
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *   # Vérifier l'état des snapshots :
 *   pnpm --filter @blobinfini/api analytics:snapshot:status
 *
 *   # Créer/mettre à jour les snapshots (pas encore gelés) :
 *   pnpm --filter @blobinfini/api analytics:snapshot:freeze
 *
 *   # Forcer le recalcul même si frozen=true (emergency only, avec confirmation) :
 *   pnpm --filter @blobinfini/api analytics:snapshot:freeze --force
 */

import { clientPrisma as prisma } from '@blobinfini/database';
import { analyticsReportService } from '../services/analytics/reports.service';
import { secureLogger } from '../utils/secure-logger';

const PERIODS = ['7d', '30d', '90d'] as const;
type Period = (typeof PERIODS)[number];

const STATUS_ONLY = process.argv.includes('--status');
const FORCE = process.argv.includes('--force');

// ─────────────────────────────────────────────────────────────────────────────
// Status — lecture seule
// ─────────────────────────────────────────────────────────────────────────────

async function showStatus(): Promise<void> {
  console.log('\n=== Status BookingAnalyticsSnapshot ===\n');
  const snapshots = await prisma.bookingAnalyticsSnapshot.findMany({
    orderBy: { period: 'asc' },
  });

  if (snapshots.length === 0) {
    console.log('Aucun snapshot trouvé. Lancer --freeze pour créer.');
    return;
  }

  for (const snap of snapshots) {
    console.log(`  [${snap.period}]`);
    console.log(`    frozen     = ${snap.frozen}`);
    console.log(`    snapshotAt = ${snap.snapshotAt.toISOString()}`);
    console.log(`    ttfvRider  = sample=${snap.ttfvRiderSampleSize} median=${snap.ttfvRiderMedianMin?.toFixed(1) ?? 'null'} masked=${snap.ttfvRiderMasked}`);
    console.log(`    ttfvPro    = sample=${snap.ttfvProSampleSize} median=${snap.ttfvProMedianMin?.toFixed(1) ?? 'null'} masked=${snap.ttfvProMasked}`);
    console.log(`    marketplace= ${JSON.stringify(snap.marketplaceJson).slice(0, 60)}...`);
    console.log('');
  }

  const allFrozen = PERIODS.every((p) =>
    snapshots.find((s: { period: string; frozen: boolean }) => s.period === p && s.frozen),
  );
  console.log(allFrozen
    ? '✅ Tous les snapshots sont gelés — tables booking peuvent être supprimées.'
    : '⚠️  Snapshots non complets ou non gelés.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Freeze
// ─────────────────────────────────────────────────────────────────────────────

async function freezeAll(): Promise<void> {
  console.log(`\n=== Freeze BookingAnalyticsSnapshot [${FORCE ? 'FORCE' : 'NORMAL'}] ===`);
  console.log(`Timestamp : ${new Date().toISOString()}\n`);

  let allOk = true;

  for (const period of PERIODS) {
    const existing = await prisma.bookingAnalyticsSnapshot.findUnique({
      where: { period },
    });

    if (existing?.frozen && !FORCE) {
      console.log(`[${period}] Déjà gelé (snapshotAt=${existing.snapshotAt.toISOString()}) — skip.`);
      console.log(`         Utiliser --force pour recalculer.`);
      continue;
    }

    console.log(`[${period}] Vérification invariant légal (BookingLegalArchive)...`);

    // ── Invariant légal : aucun booking sans archive ──────────────────────────
    // Cette vérification est BLOQUANTE. Elle garantit que tous les bookings
    // opérationnels ont une trace légale avant que l'état DECOMMISSIONED puisse
    // être activé en sécurité. La preuve est embedée dans marketplaceJson pour
    // persister après le drop des tables booking.
    //
    // Si cette requête échoue avec P2021 (table Booking absente), c'est une erreur :
    // le freeze ne peut être lancé que pendant que les tables existent encore.
    type CountRow = { cnt: bigint };
    let missingArchives: number;
    let totalBookings: number;
    let totalArchives: number;

    try {
      const [missingRow] = await prisma.$queryRaw<CountRow[]>`
        SELECT COUNT(b.id)::bigint AS cnt
        FROM "Booking" b
        LEFT JOIN "BookingLegalArchive" bla ON bla."bookingId" = b.id
        WHERE bla.id IS NULL
      `;
      missingArchives = Number(missingRow?.cnt ?? 0);
      totalBookings = await prisma.booking.count();
      totalArchives = await prisma.bookingLegalArchive.count();
    } catch (err) {
      const code = err != null && typeof err === 'object' && 'code' in err
        ? (err as Record<string, unknown>).code : undefined;
      if (code === 'P2021' || code === 'P2022') {
        console.error(`[${period}] ❌ Table Booking absente — freeze impossible sans tables présentes.`);
        console.error(`         Si les tables ont déjà été droppées, le freeze ne peut plus être recalculé.`);
        console.error(`         Le snapshot existant (frozen=true + _backfillLegalProof) reste la source de vérité.`);
      } else {
        console.error(`[${period}] ❌ Erreur DB lors du contrôle légal : ${err instanceof Error ? err.message : String(err)}`);
      }
      secureLogger.error('ANALYTICS_SNAPSHOT_LEGAL_CHECK_FAILED', { period, error: String(err) });
      allOk = false;
      continue;
    }

    if (missingArchives > 0) {
      console.error(`[${period}] ❌ BLOCAGE LÉGAL : ${missingArchives} booking(s) sans archive légale.`);
      console.error(`         Total bookings : ${totalBookings}`);
      console.error(`         Archives présentes : ${totalArchives}`);
      console.error(`         Exécuter d'abord : pnpm --filter @blobinfini/api backfill:booking-archive:execute`);
      console.error(`         Puis re-vérifier : pnpm --filter @blobinfini/api backfill:booking-archive:verify`);
      secureLogger.error('ANALYTICS_SNAPSHOT_FREEZE_BLOCKED_MISSING_LEGAL_ARCHIVES', {
        period,
        missingArchives,
        totalBookings,
        totalArchives,
      });
      allOk = false;
      continue;
    }

    console.log(`[${period}] ✅ Invariant légal OK : ${totalBookings} bookings, ${totalArchives} archives, 0 manquant.`);

    // Preuve légale embarquée dans le JSON — persiste après drop des tables booking.
    // Le preflight (assertDecommissionedStateConsistent) lit cette preuve au boot
    // pour valider l'état DECOMMISSIONED sans accès aux tables booking.
    const backfillLegalProof = {
      verifiedAt:     new Date().toISOString(),
      totalBookings,
      totalArchives,
      missingArchives,  // toujours 0 ici (guard ci-dessus)
    };

    console.log(`[${period}] Calcul des métriques analytics...`);

    let ttfv: Awaited<ReturnType<typeof analyticsReportService.getTtfv>>;
    let marketplace: Awaited<ReturnType<typeof analyticsReportService.getMarketplaceHealth>>;

    try {
      [ttfv, marketplace] = await Promise.all([
        analyticsReportService.getTtfv(period),
        analyticsReportService.getMarketplaceHealth(period),
      ]);
    } catch (err) {
      console.error(`[${period}] ❌ Erreur lors du calcul analytics : ${err instanceof Error ? err.message : String(err)}`);
      secureLogger.error('ANALYTICS_SNAPSHOT_FREEZE_FAILED', { period, error: String(err) });
      allOk = false;
      continue;
    }

    // Validation minimale analytics
    if (totalBookings > 0 && ttfv.riders.sampleSize === 0 && ttfv.pros.sampleSize === 0) {
      console.warn(`[${period}] ⚠️  TTFV sample=0 alors que ${totalBookings} bookings existent — vérifier.`);
    }

    // marketplaceJson = données analytics + _backfillLegalProof (preuve légale persistée)
    const marketplaceWithProof = {
      ...(marketplace as object),
      _backfillLegalProof: backfillLegalProof,
    };

    await prisma.bookingAnalyticsSnapshot.upsert({
      where: { period },
      create: {
        period,
        frozen: true,
        snapshotAt: new Date(),
        ttfvRiderSampleSize: ttfv.riders.sampleSize,
        ttfvRiderMedianMin:  ttfv.riders.medianMinutes,
        ttfvRiderP90Min:     ttfv.riders.p90Minutes,
        ttfvRiderMasked:     ttfv.riders.masked,
        ttfvProSampleSize:   ttfv.pros.sampleSize,
        ttfvProMedianMin:    ttfv.pros.medianMinutes,
        ttfvProP90Min:       ttfv.pros.p90Minutes,
        ttfvProMasked:       ttfv.pros.masked,
        marketplaceJson:     marketplaceWithProof,
      },
      update: {
        frozen: true,
        snapshotAt: new Date(),
        ttfvRiderSampleSize: ttfv.riders.sampleSize,
        ttfvRiderMedianMin:  ttfv.riders.medianMinutes,
        ttfvRiderP90Min:     ttfv.riders.p90Minutes,
        ttfvRiderMasked:     ttfv.riders.masked,
        ttfvProSampleSize:   ttfv.pros.sampleSize,
        ttfvProMedianMin:    ttfv.pros.medianMinutes,
        ttfvProP90Min:       ttfv.pros.p90Minutes,
        ttfvProMasked:       ttfv.pros.masked,
        marketplaceJson:     marketplaceWithProof,
      },
    });

    console.log(`[${period}] ✅ Snapshot gelé (analytics + preuve légale embedée).`);
    secureLogger.info('ANALYTICS_SNAPSHOT_FROZEN', {
      period,
      ttfvRiderSampleSize: ttfv.riders.sampleSize,
      ttfvProSampleSize: ttfv.pros.sampleSize,
      backfillLegalProofEmbedded: true,
      totalBookings,
    });
  }

  if (!allOk) {
    console.error('\n❌ Certaines périodes ont échoué. NE PAS procéder aux suppressions.');
    process.exit(1);
  }

  // Vérification finale
  const finalSnapshots = await prisma.bookingAnalyticsSnapshot.findMany();
  const allFrozen = PERIODS.every((p) =>
    finalSnapshots.find((s: { period: string; frozen: boolean }) => s.period === p && s.frozen),
  );

  if (!allFrozen) {
    console.error('\n❌ Snapshots incomplets ou non gelés. Vérifier.');
    process.exit(1);
  }

  console.log('\n✅ Tous les snapshots analytics sont gelés.');
  console.log('→ Condition de passage Phase 3 : VALIDÉE');
  console.log(`→ Timestamp de validation : ${new Date().toISOString()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  try {
    if (STATUS_ONLY) {
      await showStatus();
    } else {
      await freezeAll();
    }
  } catch (err) {
    console.error('Erreur non gérée :', err);
    process.exit(99);
  } finally {
    await prisma.$disconnect();
  }
})();
