import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { createHash } from 'crypto';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface FanoutRecord {
  riderRef: string;
  // sha256(riderId + UTC-date)[:16] — déduplique les fanouts d'un même rider-jour.
  // Un rider avec cooldown 1h peut déclencher N fanouts/jour pour la même demande
  // active. Ce champ permet COUNT(DISTINCT lessonRequestId) au lieu de COUNT(*).
  lessonRequestId: string;
  sport: string | null;
  prosFound: number;
  prosNotified: number;
  failureCount: number;
}

export interface LessonPerformanceMetrics {
  // Demandes uniques (COUNT DISTINCT lessonRequestId) — pas les fanouts bruts.
  requestsToday: number;
  requests7d: number;
  prosNotifiedToday: number;
  prosNotified7d: number;
  // Moyenne pros notifiés par fanout (prosNotified / nb fanouts).
  avgProsPerRequest: number;
  // Moyenne pros éligibles trouvés par fanout (prosFound / nb fanouts).
  avgProsFound: number;
  // Fanouts où prosFound = 0 : aucun pro dans le périmètre.
  noMatchRequests: number;
  // Taux de fanouts avec au moins 1 pro trouvé (%).
  matchRate: number | null;
  notificationFailures: number;
  // succès / (succès + échecs) * 100.
  notificationSuccessRate: number | null;
}

// ─── Hash helpers ─────────────────────────────────────────────────────────────

// SHA-256 tronqué à 24 hex chars (96 bits).
//
// Pourquoi SHA-256 (non-HMAC) :
//   • Les riders sont identifiés par des UUIDs v4 (128 bits d'entropie).
//     Un attaquant qui veut inverser un hash devrait pré-calculer sha256(uuid)
//     pour tous les UUIDs possibles — l'espace est 2^122 : infaisable.
//   • HMAC-SHA256 avec un secret apporterait une protection supplémentaire contre
//     une attaque avec liste de UUIDs connus. Si ce risque devient réel (export
//     DB compromis + liste d'utilisateurs), migrer vers HMAC avec LOG_ACTOR_SECRET.
//   • Le champ n'est jamais retourné dans la réponse API — il n'a pas de surface
//     d'attaque directe.
export function hashRiderRef(riderId: string): string {
  return createHash('sha256').update(riderId).digest('hex').slice(0, 24);
}

// sha256(riderId + UTC-date)[:16] — stable pour un rider sur une même journée.
// Garantie : deux fanouts du même rider le même jour UTC partagent le même
// lessonRequestId. COUNT(DISTINCT lessonRequestId) = riders uniques actifs/jour.
export function makeLessonRequestId(riderId: string): string {
  const utcDate = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  return createHash('sha256').update(riderId + utcDate).digest('hex').slice(0, 16);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function recordFanout(record: FanoutRecord): Promise<void> {
  await prisma.lessonFanout.create({ data: record });
}

// ─── Read (métriques admin) ───────────────────────────────────────────────────

type AggRow = {
  requestsToday: bigint;
  requests7d: bigint;
  prosNotifiedToday: bigint;
  prosNotified7d: bigint;
  avgProsPerRequest: number | null;
  avgProsFound: number | null;
  noMatchRequests: bigint;
  matchRate: number | null;
  notificationFailures: bigint;
};

export async function getLessonPerformanceMetrics(): Promise<LessonPerformanceMetrics> {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Un seul index range scan sur LessonFanout_createdAt_idx.
  // FILTER évite plusieurs passes ; COUNT(DISTINCT) utilise LessonFanout_lessonRequestId_idx.
  // Complexité : O(rows dans la fenêtre de 7j) — sub-ms à l'échelle MVP.
  const rows = await prisma.$queryRaw<AggRow[]>(Prisma.sql`
    SELECT
      COUNT(DISTINCT "lessonRequestId") FILTER (WHERE "createdAt" >= ${todayStart})
                                                                            AS "requestsToday",
      COUNT(DISTINCT "lessonRequestId")                                     AS "requests7d",
      COALESCE(SUM("prosNotified") FILTER (WHERE "createdAt" >= ${todayStart}), 0)
                                                                            AS "prosNotifiedToday",
      COALESCE(SUM("prosNotified"), 0)                                      AS "prosNotified7d",
      AVG("prosNotified")::float                                            AS "avgProsPerRequest",
      AVG("prosFound")::float                                               AS "avgProsFound",
      COUNT(*) FILTER (WHERE "prosFound" = 0)                              AS "noMatchRequests",
      ROUND(
        COUNT(*) FILTER (WHERE "prosFound" > 0)::numeric
        / NULLIF(COUNT(*), 0)
        * 100,
        1
      )::float                                                              AS "matchRate",
      COALESCE(SUM("failureCount"), 0)                                     AS "notificationFailures"
    FROM "LessonFanout"
    WHERE "createdAt" >= ${sevenDaysAgo}
  `);

  const row = rows[0];

  const prosNotified7d = Number(row.prosNotified7d);
  const notificationFailures = Number(row.notificationFailures);
  const totalAttempts = prosNotified7d + notificationFailures;

  return {
    requestsToday: Number(row.requestsToday),
    requests7d: Number(row.requests7d),
    prosNotifiedToday: Number(row.prosNotifiedToday),
    prosNotified7d,
    avgProsPerRequest:
      row.avgProsPerRequest !== null ? Math.round(row.avgProsPerRequest * 10) / 10 : 0,
    avgProsFound:
      row.avgProsFound !== null ? Math.round(row.avgProsFound * 10) / 10 : 0,
    noMatchRequests: Number(row.noMatchRequests),
    matchRate: row.matchRate,
    notificationFailures,
    notificationSuccessRate:
      totalAttempts > 0
        ? Math.round((prosNotified7d / totalAttempts) * 1000) / 10
        : null,
  };
}
