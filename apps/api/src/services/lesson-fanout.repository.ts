import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { createHash } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Raison du déclenchement d'un fanout.
 *
 * ACTIVATED       — wantsLesson vient de passer false → true.
 * LOCATION_CHANGED — déplacement géographique > 100 m détecté.
 * SPORT_CHANGED    — changement de sport demandé (surf ↔ kitesurf).
 * MANUAL          — déclenchement explicite (admin, test, retry).
 */
export type FanoutTriggerReason =
  | 'ACTIVATED'
  | 'LOCATION_CHANGED'
  | 'SPORT_CHANGED'
  | 'MANUAL';

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
  // Raison du déclenchement — null pour les lignes antérieures au sprint 2026-05-20.
  triggerReason: FanoutTriggerReason | null;
}

/** Métriques par sport pour le dashboard admin. */
export interface SportBreakdown {
  // Demandes uniques (COUNT DISTINCT lessonRequestId) sur 7 jours.
  requests7d: number;
  // Taux de fanouts avec ≥ 1 pro trouvé (%), null si aucun fanout.
  matchRate: number | null;
  // Moyenne pros éligibles trouvés par fanout.
  avgProsFound: number;
}

export interface LessonPerformanceMetrics {
  // Demandes uniques (COUNT DISTINCT lessonRequestId) — pas les fanouts bruts.
  requestsToday: number;
  // requests7d = COUNT(DISTINCT lessonRequestId) sur 7 jours.
  // NOTE : ce compteur mesure les "rider-jours actifs", pas les riders uniques.
  // Un même rider avec une demande active 3 jours = 3 lessonRequestIds distincts.
  // Pour les riders uniques, voir uniqueRiders7d.
  requests7d: number;
  // uniqueRiders7d = COUNT(DISTINCT riderRef) sur 7 jours.
  // Mesure les riders réellement distincts, indépendamment du nombre de jours actifs.
  uniqueRiders7d: number;
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
  // Métriques agrégées par sport (surf / kitesurf / other).
  bySport: {
    surf: SportBreakdown;
    kitesurf: SportBreakdown;
    other: SportBreakdown;
  };
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
  uniqueRiders7d: bigint;
  prosNotifiedToday: bigint;
  prosNotified7d: bigint;
  avgProsPerRequest: number | null;
  avgProsFound: number | null;
  noMatchRequests: bigint;
  matchRate: number | null;
  notificationFailures: bigint;
};

type SportRow = {
  sport: string;
  requests7d: bigint;
  matchRate: number | null;
  avgProsFound: number | null;
};

const EMPTY_SPORT: SportBreakdown = { requests7d: 0, matchRate: null, avgProsFound: 0 };

// ─── Supply Diagnostics ───────────────────────────────────────────────────────

export interface SportSupplyBreakdown {
  prosVerified: number;
  prosWithLocation: number;
  prosNotifyEnabled: number;
}

export interface SupplyDiagnosticsMetrics {
  verifiedProsTotal: number;
  verifiedProsWithLocation: number;
  verifiedProsMissingLocation: number;
  verifiedProsNotifyLessonEnabled: number;
  verifiedProsLessonOptOut: number;
  bySport: {
    surf: SportSupplyBreakdown;
    kitesurf: SportSupplyBreakdown;
  };
}

export async function getLessonPerformanceMetrics(): Promise<LessonPerformanceMetrics> {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Deux requêtes parallèles pour éviter un GROUP BY + FILTER complexe :
  //   1. Agrégat global (même structure qu'avant + uniqueRiders7d).
  //   2. Agrégat par sport (surf / kitesurf / null→other).
  // Les deux utilisent l'index LessonFanout_createdAt_idx (range scan 7 jours).
  const [rows, sportRows]: [AggRow[], SportRow[]] = await Promise.all([
    prisma.$queryRaw<AggRow[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT "lessonRequestId") FILTER (WHERE "createdAt" >= ${todayStart})
                                                                              AS "requestsToday",
        COUNT(DISTINCT "lessonRequestId")                                     AS "requests7d",
        COUNT(DISTINCT "riderRef")                                            AS "uniqueRiders7d",
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
    `),

    prisma.$queryRaw<SportRow[]>(Prisma.sql`
      SELECT
        COALESCE("sport", 'other')                                           AS "sport",
        COUNT(DISTINCT "lessonRequestId")                                     AS "requests7d",
        ROUND(
          COUNT(*) FILTER (WHERE "prosFound" > 0)::numeric
          / NULLIF(COUNT(*), 0)
          * 100,
          1
        )::float                                                              AS "matchRate",
        AVG("prosFound")::float                                               AS "avgProsFound"
      FROM "LessonFanout"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY COALESCE("sport", 'other')
    `),
  ]);

  const row = rows[0];

  const prosNotified7d = Number(row.prosNotified7d);
  const notificationFailures = Number(row.notificationFailures);
  const totalAttempts = prosNotified7d + notificationFailures;

  // Convertit une ligne SportRow en SportBreakdown typé.
  const toBreakdown = (sr: SportRow | undefined): SportBreakdown => {
    if (!sr) return EMPTY_SPORT;
    return {
      requests7d: Number(sr.requests7d),
      matchRate: sr.matchRate,
      avgProsFound: sr.avgProsFound !== null ? Math.round(sr.avgProsFound * 10) / 10 : 0,
    };
  };

  const sportMap = new Map<string, SportRow>(sportRows.map((sr): [string, SportRow] => [sr.sport, sr]));

  return {
    requestsToday: Number(row.requestsToday),
    requests7d: Number(row.requests7d),
    uniqueRiders7d: Number(row.uniqueRiders7d),
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
    bySport: {
      surf: toBreakdown(sportMap.get('surf')),
      kitesurf: toBreakdown(sportMap.get('kitesurf')),
      other: toBreakdown(sportMap.get('other')),
    },
  };
}

// ─── Contact Conversion Metrics (Sprint C2) ───────────────────────────────────

export interface ContactConversionMetrics {
  // COUNT(DISTINCT lessonRequestId) dans LessonFanout sur 7 jours.
  requests7d: number;
  // COUNT(DISTINCT lessonRequestId) dans ContactRequest (non-null) sur 7 jours.
  contacted7d: number;
  // contacted7d / requests7d * 100 (1 décimale), null si requests7d = 0.
  contactRatePct: number | null;
}

type ConvRow = {
  requests7d: bigint;
  contacted7d: bigint;
  contact_rate_pct: number | null;
};

export async function getContactConversionMetrics(): Promise<ContactConversionMetrics> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [row] = await prisma.$queryRaw<ConvRow[]>(Prisma.sql`
    SELECT
      COUNT(DISTINCT lf."lessonRequestId")                                   AS "requests7d",
      COUNT(DISTINCT cr."lessonRequestId")
        FILTER (WHERE cr."lessonRequestId" IS NOT NULL)                      AS "contacted7d",
      ROUND(
        COUNT(DISTINCT cr."lessonRequestId")
          FILTER (WHERE cr."lessonRequestId" IS NOT NULL)::numeric
        / NULLIF(COUNT(DISTINCT lf."lessonRequestId"), 0) * 100,
        1
      )::float                                                               AS "contact_rate_pct"
    FROM "LessonFanout" lf
    LEFT JOIN "ContactRequest" cr
      ON cr."lessonRequestId" = lf."lessonRequestId"
      AND cr."createdAt" >= ${sevenDaysAgo}
    WHERE lf."createdAt" >= ${sevenDaysAgo}
  `);

  return {
    requests7d: Number(row.requests7d),
    contacted7d: Number(row.contacted7d),
    contactRatePct: row.contact_rate_pct,
  };
}

// ─── Coverage Metrics (Sprint C3) ────────────────────────────────────────────

// Mesure la couverture géographique des demandes de cours sur 7 jours.
// "couverte" = au moins un fanout de ce lessonRequestId avait prosFound > 0.
export interface CoverageMetrics {
  // Demandes uniques (COUNT DISTINCT lessonRequestId) sur 7 jours.
  requests7d: number;
  // Demandes pour lesquelles au moins un fanout a trouvé ≥ 1 pro.
  covered7d: number;
  // covered7d / requests7d * 100 (1 décimale), null si requests7d = 0.
  coverageRatePct: number | null;
}

type CovRow = {
  requests7d: bigint;
  covered7d: bigint;
  coverage_rate_pct: number | null;
};

export async function getLessonCoverageMetrics(): Promise<CoverageMetrics> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Une seule requête sur LessonFanout (index createdAt) — pas de JOIN.
  // COUNT(DISTINCT CASE WHEN prosFound > 0 THEN lessonRequestId END) garantit
  // qu'une demande est "couverte" si AU MOINS UN de ses fanouts a trouvé un pro.
  const [row] = await prisma.$queryRaw<CovRow[]>(Prisma.sql`
    SELECT
      COUNT(DISTINCT "lessonRequestId")                                        AS "requests7d",
      COUNT(DISTINCT CASE WHEN "prosFound" > 0 THEN "lessonRequestId" END)    AS "covered7d",
      ROUND(
        COUNT(DISTINCT CASE WHEN "prosFound" > 0 THEN "lessonRequestId" END)::numeric
        / NULLIF(COUNT(DISTINCT "lessonRequestId"), 0) * 100,
        1
      )::float                                                                 AS "coverage_rate_pct"
    FROM "LessonFanout"
    WHERE "createdAt" >= ${sevenDaysAgo}
  `);

  return {
    requests7d: Number(row.requests7d),
    covered7d: Number(row.covered7d),
    coverageRatePct: row.coverage_rate_pct,
  };
}

// ─── Analytics Overview (Sprint C4) ──────────────────────────────────────────

// Vue décisionnelle agrégée : fusion C2 (contact-conversion) + C3 (coverage)
// en une seule requête SQL sur 7 jours glissants.
//
// Sémantique identique à C2/C3 séparés :
//   requests7d      = COUNT(DISTINCT lf.lessonRequestId) WHERE lf.createdAt >= 7j
//   contacted7d     = COUNT(DISTINCT cr.lessonRequestId) du LEFT JOIN C2
//   covered7d       = COUNT(DISTINCT CASE WHEN prosFound > 0 THEN lr END) de C3
//
// Le LEFT JOIN ne biaise pas requests7d ni covered7d car COUNT DISTINCT
// est insensible à la multiplication de lignes par le JOIN.

export interface AnalyticsOverviewMetrics {
  requests7d: number;
  contacted7d: number;
  contactRatePct: number | null;
  covered7d: number;
  coverageRatePct: number | null;
}

type OverviewRow = {
  requests7d: bigint;
  contacted7d: bigint;
  contact_rate_pct: number | null;
  covered7d: bigint;
  coverage_rate_pct: number | null;
};

export async function getAnalyticsOverviewMetrics(): Promise<AnalyticsOverviewMetrics> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [row] = await prisma.$queryRaw<OverviewRow[]>(Prisma.sql`
    SELECT
      COUNT(DISTINCT lf."lessonRequestId")                                       AS "requests7d",
      COUNT(DISTINCT cr."lessonRequestId")
        FILTER (WHERE cr."lessonRequestId" IS NOT NULL)                          AS "contacted7d",
      ROUND(
        COUNT(DISTINCT cr."lessonRequestId")
          FILTER (WHERE cr."lessonRequestId" IS NOT NULL)::numeric
        / NULLIF(COUNT(DISTINCT lf."lessonRequestId"), 0) * 100,
        1
      )::float                                                                   AS "contact_rate_pct",
      COUNT(DISTINCT CASE WHEN lf."prosFound" > 0 THEN lf."lessonRequestId" END)
                                                                                 AS "covered7d",
      ROUND(
        COUNT(DISTINCT CASE WHEN lf."prosFound" > 0 THEN lf."lessonRequestId" END)::numeric
        / NULLIF(COUNT(DISTINCT lf."lessonRequestId"), 0) * 100,
        1
      )::float                                                                   AS "coverage_rate_pct"
    FROM "LessonFanout" lf
    LEFT JOIN "ContactRequest" cr
      ON cr."lessonRequestId" = lf."lessonRequestId"
      AND cr."createdAt" >= ${sevenDaysAgo}
    WHERE lf."createdAt" >= ${sevenDaysAgo}
  `);

  return {
    requests7d: Number(row.requests7d),
    contacted7d: Number(row.contacted7d),
    contactRatePct: row.contact_rate_pct,
    covered7d: Number(row.covered7d),
    coverageRatePct: row.coverage_rate_pct,
  };
}

// Snapshot instantané de l'offre pro disponible pour les fanouts de cours.
// Pas de filtre temporel : c'est l'état courant de la base.
export async function getSupplyDiagnosticsMetrics(): Promise<SupplyDiagnosticsMetrics> {
  const [
    verifiedProsTotal,
    verifiedProsWithLocation,
    verifiedProsLessonOptOut,
    surfNotEnabled,
    kitesurfNotEnabled,
  ] = await Promise.all([
    prisma.proProfile.count({
      where: { verified: true, user: { deletedAt: null } },
    }),
    prisma.proProfile.count({
      where: { verified: true, lat: { not: null }, lng: { not: null }, user: { deletedAt: null } },
    }),
    // Pros qui ont explicitement désactivé les notifs de cours.
    prisma.proProfile.count({
      where: {
        verified: true,
        user: { deletedAt: null, notificationPreferences: { notifyLessonRequests: false } },
      },
    }),
    // Pros non éligibles aux fanouts surf : NP existe ET (notifyLessonRequests=false OU notifyForSurf=false).
    // Pros sans NP = defaults true = éligibles → non comptés ici.
    prisma.proProfile.count({
      where: {
        verified: true,
        user: {
          deletedAt: null,
          notificationPreferences: {
            OR: [{ notifyLessonRequests: false }, { notifyForSurf: false }],
          },
        },
      },
    }),
    // Même logique pour kitesurf.
    prisma.proProfile.count({
      where: {
        verified: true,
        user: {
          deletedAt: null,
          notificationPreferences: {
            OR: [{ notifyLessonRequests: false }, { notifyForKitesurf: false }],
          },
        },
      },
    }),
  ]);

  const sportBreakdown = (notEnabled: number): SportSupplyBreakdown => ({
    prosVerified: verifiedProsTotal,
    prosWithLocation: verifiedProsWithLocation,
    prosNotifyEnabled: verifiedProsTotal - notEnabled,
  });

  return {
    verifiedProsTotal,
    verifiedProsWithLocation,
    verifiedProsMissingLocation: verifiedProsTotal - verifiedProsWithLocation,
    verifiedProsNotifyLessonEnabled: verifiedProsTotal - verifiedProsLessonOptOut,
    verifiedProsLessonOptOut,
    bySport: {
      surf: sportBreakdown(surfNotEnabled),
      kitesurf: sportBreakdown(kitesurfNotEnabled),
    },
  };
}
