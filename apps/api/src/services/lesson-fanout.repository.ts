import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { createHash } from 'crypto';
import { PRIVACY_THRESHOLD } from './analytics/definitions';

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
  // Zone géographique large (grille 1° ≈ 111 km) — ex: "Z43:-2".
  // null pour les lignes antérieures au sprint C7 (2026-05-23).
  zoneLarge: string | null;
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

// ─── Analytics Overview (Sprint C4 + C5) ─────────────────────────────────────

// Vue décisionnelle agrégée : fusion C2 (contact-conversion) + C3 (coverage)
// + breakdown par sport (C5) — deux requêtes parallèles sur 7 jours glissants.
//
// Sémantique identique à C2/C3 séparés :
//   requests7d      = COUNT(DISTINCT lf.lessonRequestId) WHERE lf.createdAt >= 7j
//   contacted7d     = COUNT(DISTINCT cr.lessonRequestId) du LEFT JOIN C2
//   covered7d       = COUNT(DISTINCT CASE WHEN prosFound > 0 THEN lr END) de C3
//
// Le LEFT JOIN ne biaise pas requests7d ni covered7d car COUNT DISTINCT
// est insensible à la multiplication de lignes par le JOIN.

// Métriques conversion + couverture pour un sport donné (C5).
export interface SportConversionBreakdown {
  sport: string;
  requests7d: number;
  contacted7d: number;
  // null si requests7d = 0
  contactRatePct: number | null;
  covered7d: number;
  // null si requests7d = 0
  coverageRatePct: number | null;
}

// Métriques par zone géographique large pour le dashboard admin (Sprint C7).
// Zones exclues si requests7d < PRIVACY_THRESHOLD (anonymisation RGPD).
export interface GeoBreakdown {
  // Code de zone — ex: "Z43:-2" (grille 1° ≈ 111 km). Opaque, non-identifiant.
  zone: string;
  // Demandes uniques (COUNT DISTINCT lessonRequestId) sur 7 jours.
  requests7d: number;
  // Demandes pour lesquelles au moins un fanout a trouvé ≥ 1 pro.
  covered7d: number;
  // covered7d / requests7d * 100 (1 décimale), null si requests7d = 0.
  coverageRatePct: number | null;
  // Demandes uniques ayant au moins un ContactRequest sur 7 jours.
  contacted7d: number;
  // contacted7d / requests7d * 100 (1 décimale), null si requests7d = 0.
  contactRatePct: number | null;
}

// Métriques par raison de déclenchement pour le dashboard admin (Sprint C6).
export interface ReasonBreakdown {
  // COALESCE(triggerReason, 'UNKNOWN') — 'UNKNOWN' pour les lignes legacy (null).
  reason: string;
  // Nombre brut de fanouts (COUNT DISTINCT id — insensible au LEFT JOIN inflation).
  fanouts7d: number;
  // Demandes uniques (COUNT DISTINCT lessonRequestId).
  requests7d: number;
  // Demandes uniques ayant au moins un ContactRequest.
  contacted7d: number;
  // contacted7d / requests7d * 100 (1 décimale), null si requests7d = 0.
  contactRatePct: number | null;
  // Demandes uniques ayant prosFound > 0 sur au moins un fanout.
  covered7d: number;
  // covered7d / requests7d * 100 (1 décimale), null si requests7d = 0.
  coverageRatePct: number | null;
}

// ─── Marketplace Funnel (Sprint C8) ──────────────────────────────────────────

// Étapes du funnel calculables avec les données existantes :
//   requests7d  — COUNT(DISTINCT lessonRequestId) dans LessonFanout sur 7 jours.
//   covered7d   — demandes où au moins un fanout avait prosFound > 0 (C3).
//   contacted7d — demandes ayant au moins un ContactRequest (C2).
//
// Étapes non calculables (données absentes) :
//   • "pro a vu la notification" — pas de tracking de lecture
//   • "pro a répondu" — ContactRequest n'a pas de statut d'acceptation
//   • "leçon finalisée" — module booking retiré
export interface MarketplaceFunnel {
  requests7d: number;
  covered7d: number;
  contacted7d: number;
  // requests7d - covered7d
  coverageLoss: number;
  // covered7d - contacted7d
  contactLoss: number;
  // covered7d / requests7d * 100 (1 décimale), null si requests7d = 0
  coverageRatePct: number | null;
  // contacted7d / requests7d * 100 (1 décimale), null si requests7d = 0
  contactRatePct: number | null;
}

export type MarketplaceBottleneck = 'PRO_SUPPLY' | 'PRO_RESPONSE' | 'HEALTHY';
export type MarketplaceSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface MarketplaceHealth {
  // Règles déterministes et testables — aucune heuristique opaque :
  //   PRO_SUPPLY   : coverageRatePct < 50 (pas assez de pros dans le périmètre)
  //   PRO_RESPONSE : coverageRatePct >= 50 ET contactRatePct < 30 (pros trouvés mais pas de réponse)
  //   HEALTHY      : coverageRatePct >= 50 ET contactRatePct >= 30 (ou aucune donnée)
  primaryBottleneck: MarketplaceBottleneck;
  // HIGH   : situation critique (coverageRatePct < 30 ou contactRatePct < 15)
  // MEDIUM : dégradation notable (coverageRatePct < 50 ou contactRatePct < 30)
  // LOW    : normal
  severity: MarketplaceSeverity;
}

// Calcule le funnel et l'insight à partir des métriques déjà agrégées — O(1), sans SQL.
export function computeMarketplaceFunnel(
  requests7d: number,
  covered7d: number,
  contacted7d: number,
  coverageRatePct: number | null,
  contactRatePct: number | null,
): { funnel: MarketplaceFunnel; health: MarketplaceHealth } {
  const funnel: MarketplaceFunnel = {
    requests7d,
    covered7d,
    contacted7d,
    coverageLoss: requests7d - covered7d,
    contactLoss: covered7d - contacted7d,
    coverageRatePct,
    contactRatePct,
  };

  let primaryBottleneck: MarketplaceBottleneck;
  let severity: MarketplaceSeverity;

  if (coverageRatePct === null) {
    // Aucun fanout sur la période — pas de données pour diagnostiquer
    primaryBottleneck = 'HEALTHY';
    severity = 'LOW';
  } else if (coverageRatePct < 50) {
    primaryBottleneck = 'PRO_SUPPLY';
    severity = coverageRatePct < 30 ? 'HIGH' : 'MEDIUM';
  } else if (contactRatePct !== null && contactRatePct < 30) {
    primaryBottleneck = 'PRO_RESPONSE';
    severity = contactRatePct < 15 ? 'HIGH' : 'MEDIUM';
  } else {
    primaryBottleneck = 'HEALTHY';
    severity = 'LOW';
  }

  return { funnel, health: { primaryBottleneck, severity } };
}

export interface AnalyticsOverviewMetrics {
  requests7d: number;
  contacted7d: number;
  contactRatePct: number | null;
  covered7d: number;
  coverageRatePct: number | null;
  // Présent uniquement quand au moins un fanout a sport IN ('surf','kitesurf').
  bySport: SportConversionBreakdown[];
  // Breakdown par triggerReason — max 5 groupes (4 valeurs + UNKNOWN pour legacy).
  reasonBreakdown: ReasonBreakdown[];
  // Breakdown par zone géographique large — zones avec < PRIVACY_THRESHOLD demandes exclues.
  // Vide si aucune donnée C7 (fanouts antérieurs au sprint C7 n'ont pas zoneLarge).
  geoBreakdown: GeoBreakdown[];
  // Funnel marketplace (Sprint C8) — dérivé de C2+C3, zéro requête SQL supplémentaire.
  marketplaceFunnel: MarketplaceFunnel;
  marketplaceHealth: MarketplaceHealth;
}

type OverviewRow = {
  requests7d: bigint;
  contacted7d: bigint;
  contact_rate_pct: number | null;
  covered7d: bigint;
  coverage_rate_pct: number | null;
};

type SportOverviewRow = {
  sport: string;
  requests7d: bigint;
  contacted7d: bigint;
  contact_rate_pct: number | null;
  covered7d: bigint;
  coverage_rate_pct: number | null;
};

type ReasonOverviewRow = {
  reason: string;
  fanouts7d: bigint;
  requests7d: bigint;
  contacted7d: bigint;
  contact_rate_pct: number | null;
  covered7d: bigint;
  coverage_rate_pct: number | null;
};

type GeoOverviewRow = {
  zone: string;
  requests7d: bigint;
  covered7d: bigint;
  coverage_rate_pct: number | null;
  contacted7d: bigint;
  contact_rate_pct: number | null;
};

export async function getAnalyticsOverviewMetrics(): Promise<AnalyticsOverviewMetrics> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Quatre requêtes parallèles sur le même index LessonFanout_createdAt_idx :
  //   1. Agrégat global (C4 — inchangé).
  //   2. Agrégat par sport (C5) — filtre sport IN ('surf','kitesurf') pour exclure
  //      les lignes pré-C1 (sport NULL) et garantir un groupe borné (max 2 lignes).
  //   3. Agrégat par triggerReason (C6) — COALESCE(null, 'UNKNOWN') pour legacy.
  //      fanouts7d = COUNT(DISTINCT id) — insensible à l'inflation du LEFT JOIN.
  //      GROUP BY borné : max 5 groupes (ACTIVATED/LOCATION_CHANGED/SPORT_CHANGED/MANUAL/UNKNOWN).
  //   4. Agrégat par zone géographique large (C7) — zoneLarge IS NOT NULL (lignes pré-C7 exclues).
  //      HAVING >= PRIVACY_THRESHOLD : zones avec < 20 demandes masquées pour RGPD.
  //      GROUP BY borné : ≤ ~50 cellules 1° sur la France métropolitaine.
  const [rows, sportRows, reasonRows, geoRows]: [OverviewRow[], SportOverviewRow[], ReasonOverviewRow[], GeoOverviewRow[]] = await Promise.all([
    prisma.$queryRaw<OverviewRow[]>(Prisma.sql`
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
    `),

    prisma.$queryRaw<SportOverviewRow[]>(Prisma.sql`
      SELECT
        lf."sport",
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
        AND lf."sport" IN ('surf', 'kitesurf')
      GROUP BY lf."sport"
      ORDER BY lf."sport"
    `),

    prisma.$queryRaw<ReasonOverviewRow[]>(Prisma.sql`
      SELECT
        COALESCE(lf."triggerReason", 'UNKNOWN')                                    AS "reason",
        COUNT(DISTINCT lf."id")                                                    AS "fanouts7d",
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
      GROUP BY COALESCE(lf."triggerReason", 'UNKNOWN')
      ORDER BY COUNT(DISTINCT lf."id") DESC
    `),

    // C7 : breakdown géographique — fanouts avec zoneLarge uniquement (pré-C7 = NULL, exclus).
    // HAVING applique PRIVACY_THRESHOLD : zones avec < 20 demandes uniques masquées côté SQL.
    // Tri : requests7d DESC — zones les plus actives en premier.
    prisma.$queryRaw<GeoOverviewRow[]>(Prisma.sql`
      SELECT
        lf."zoneLarge"                                                             AS "zone",
        COUNT(DISTINCT lf."lessonRequestId")                                       AS "requests7d",
        COUNT(DISTINCT CASE WHEN lf."prosFound" > 0 THEN lf."lessonRequestId" END)
                                                                                   AS "covered7d",
        ROUND(
          COUNT(DISTINCT CASE WHEN lf."prosFound" > 0 THEN lf."lessonRequestId" END)::numeric
          / NULLIF(COUNT(DISTINCT lf."lessonRequestId"), 0) * 100,
          1
        )::float                                                                   AS "coverage_rate_pct",
        COUNT(DISTINCT cr."lessonRequestId")
          FILTER (WHERE cr."lessonRequestId" IS NOT NULL)                          AS "contacted7d",
        ROUND(
          COUNT(DISTINCT cr."lessonRequestId")
            FILTER (WHERE cr."lessonRequestId" IS NOT NULL)::numeric
          / NULLIF(COUNT(DISTINCT lf."lessonRequestId"), 0) * 100,
          1
        )::float                                                                   AS "contact_rate_pct"
      FROM "LessonFanout" lf
      LEFT JOIN "ContactRequest" cr
        ON cr."lessonRequestId" = lf."lessonRequestId"
        AND cr."createdAt" >= ${sevenDaysAgo}
      WHERE lf."createdAt" >= ${sevenDaysAgo}
        AND lf."zoneLarge" IS NOT NULL
      GROUP BY lf."zoneLarge"
      HAVING COUNT(DISTINCT lf."lessonRequestId") >= ${PRIVACY_THRESHOLD}
      ORDER BY COUNT(DISTINCT lf."lessonRequestId") DESC
    `),
  ]);

  const row = rows[0];

  const bySport: SportConversionBreakdown[] = sportRows.map((sr) => ({
    sport: sr.sport,
    requests7d: Number(sr.requests7d),
    contacted7d: Number(sr.contacted7d),
    contactRatePct: sr.contact_rate_pct,
    covered7d: Number(sr.covered7d),
    coverageRatePct: sr.coverage_rate_pct,
  }));

  const reasonBreakdown: ReasonBreakdown[] = reasonRows.map((rr) => ({
    reason: rr.reason,
    fanouts7d: Number(rr.fanouts7d),
    requests7d: Number(rr.requests7d),
    contacted7d: Number(rr.contacted7d),
    contactRatePct: rr.contact_rate_pct,
    covered7d: Number(rr.covered7d),
    coverageRatePct: rr.coverage_rate_pct,
  }));

  const geoBreakdown: GeoBreakdown[] = geoRows.map((gr) => ({
    zone: gr.zone,
    requests7d: Number(gr.requests7d),
    covered7d: Number(gr.covered7d),
    coverageRatePct: gr.coverage_rate_pct,
    contacted7d: Number(gr.contacted7d),
    contactRatePct: gr.contact_rate_pct,
  }));

  const requests7d = Number(row.requests7d);
  const covered7d = Number(row.covered7d);
  const contacted7d = Number(row.contacted7d);
  const coverageRatePct = row.coverage_rate_pct;
  const contactRatePct = row.contact_rate_pct;

  const { funnel: marketplaceFunnel, health: marketplaceHealth } = computeMarketplaceFunnel(
    requests7d,
    covered7d,
    contacted7d,
    coverageRatePct,
    contactRatePct,
  );

  return {
    requests7d,
    contacted7d,
    contactRatePct,
    covered7d,
    coverageRatePct,
    bySport,
    reasonBreakdown,
    geoBreakdown,
    marketplaceFunnel,
    marketplaceHealth,
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

// ─── Workflow Quality Metrics (Sprint C10) ─────────────────────────────────────
//
// KPI du funnel professionnel :
//   notificationReadRate      : % notifications LESSON_REQUEST_NEARBY lues
//   contactConversionRate     : ContactRequests / Notifications envoyées
//   riderResponseRate         : ContactRequests ayant ≥ 1 réponse / ContactRequests total
//   medianRiderResponseTime   : médiane de MIN(crr.createdAt) - cr.createdAt
//
// Sécurité :
//   • Réponse = agrégats uniquement — pas d'id, riderId, proUserId exposé.
//   • Fenêtre bornée (windowDays ≤ 30) — validée par Zod côté contrôleur.
//   • 3 requêtes parallèles, chacune bornée par la fenêtre temporelle.
//
// Limites connues :
//   • ContactRequest n'a pas d'index sur createdAt — scan séquentiel borné
//     par la fenêtre. Acceptable admin-only (rare). Index à créer si > 100k lignes.
//   • Anciennes notifications sans lessonRequestId en data : incluses dans
//     readCount et totalCount (filtre sur type uniquement, pas sur data).

export interface WorkflowQualityMetrics {
  windowDays: number;
  notificationReadRate: {
    readCount: number;
    totalCount: number;
    ratePct: number | null;
  };
  // contacts_per_notification : ContactRequests créés / Notifications LESSON_REQUEST_NEARBY envoyées.
  // Mesure le taux d'action des pros qui ont reçu une notification.
  // Distinct de requestContactRate (contacted7d/requests7d) qui mesure demandes → contact.
  contactConversionRate: {
    contactCount: number;
    notificationCount: number;
    ratePct: number | null;
    definition: 'contacts_per_notification';
  };
  riderResponseRate: {
    respondedContactRequests: number;
    totalContactRequests: number;
    ratePct: number | null;
  };
  medianRiderResponseTime: {
    minutes: number | null;
  };
}

type NotifQualityRow = {
  readCount: bigint;
  totalCount: bigint;
};

type ContactQualityRow = {
  contactCount: bigint;
  respondedCount: bigint;
};

type MedianRow = {
  medianMinutes: number | null;
};

function toRatePct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function getWorkflowQualityMetrics(windowDays: number): Promise<WorkflowQualityMetrics> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // 3 requêtes parallèles — indépendantes, pas de N+1.
  const [notifRows, contactRows, medianRows] = await Promise.all([
    // 1. Notification read rate + count (index Notification_createdAt_idx)
    prisma.$queryRaw<NotifQualityRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "readAt" IS NOT NULL)   AS "readCount",
        COUNT(*)                                        AS "totalCount"
      FROM "Notification"
      WHERE "type" = 'LESSON_REQUEST_NEARBY'
        AND "createdAt" >= ${windowStart}::timestamptz
    `),

    // 2. riderResponseRate — scan borné sur ContactRequest (no createdAt index, voir limites)
    //    EXISTS évite tout chargement de lignes ContactRequestResponse en mémoire.
    prisma.$queryRaw<ContactQualityRow[]>(Prisma.sql`
      SELECT
        COUNT(cr.id)                                                           AS "contactCount",
        COUNT(cr.id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "ContactRequestResponse" crr
            WHERE crr."contactRequestId" = cr.id
          )
        )                                                                       AS "respondedCount"
      FROM "ContactRequest" cr
      WHERE cr."createdAt" >= ${windowStart}::timestamptz
    `),

    // 3. Median response time — MIN(crr.createdAt) - cr.createdAt par ContactRequest.
    //    PERCENTILE_CONT(0.5) sur la CTE : O(n log n), borné par la fenêtre.
    //    Retourne NULL si aucun ContactRequest n'a de réponse sur la période.
    prisma.$queryRaw<MedianRow[]>(Prisma.sql`
      WITH per_contact AS (
        SELECT
          EXTRACT(EPOCH FROM (MIN(crr."createdAt") - cr."createdAt")) / 60.0 AS delay_min
        FROM "ContactRequest" cr
        JOIN "ContactRequestResponse" crr ON crr."contactRequestId" = cr.id
        WHERE cr."createdAt" >= ${windowStart}::timestamptz
        GROUP BY cr.id, cr."createdAt"
      )
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delay_min)::float AS "medianMinutes"
      FROM per_contact
    `),
  ]);

  const readCount = Number(notifRows[0]?.readCount ?? 0n);
  const totalCount = Number(notifRows[0]?.totalCount ?? 0n);
  const contactCount = Number(contactRows[0]?.contactCount ?? 0n);
  const respondedCount = Number(contactRows[0]?.respondedCount ?? 0n);
  const medianMinutes = medianRows[0]?.medianMinutes ?? null;

  return {
    windowDays,
    notificationReadRate: {
      readCount,
      totalCount,
      ratePct: toRatePct(readCount, totalCount),
    },
    contactConversionRate: {
      contactCount,
      notificationCount: totalCount,
      ratePct: toRatePct(contactCount, totalCount),
      definition: 'contacts_per_notification',
    },
    riderResponseRate: {
      respondedContactRequests: respondedCount,
      totalContactRequests: contactCount,
      ratePct: toRatePct(respondedCount, contactCount),
    },
    medianRiderResponseTime: {
      minutes: medianMinutes,
    },
  };
}
