/**
 * booking-decommission-state.ts
 *
 * Source unique de vérité sur la phase de décommission du module booking.
 *
 * ── PHASES ────────────────────────────────────────────────────────────────────
 *   LIVE          — module actif, tables présentes (défaut absolu)
 *   FREEZE_ACTIVE — writes bloqués explicitement via BOOKING_DISABLED=true,
 *                   tables encore présentes
 *   DECOMMISSIONED — tables supprimées ou approuvées pour suppression
 *                    Requis : BOOKING_DECOMMISSION_STATE=DECOMMISSIONED (explicite)
 *
 * ── POURQUOI PAS NODE_ENV ─────────────────────────────────────────────────────
 *   NODE_ENV=production décrit l'environnement d'exécution, pas l'état du module.
 *   Un déploiement en production peut avoir booking encore actif.
 *   Le freeze des writes est piloté par BOOKING_DISABLED=true (bookingDisabledGuard).
 *   L'état de décommission est une décision ops, pas une propriété de l'environnement.
 *
 * ── DEUX INVARIANTS DU PREFLIGHT ─────────────────────────────────────────────
 *   assertDecommissionedStateConsistent() vérifie à la fois :
 *
 *   1. Invariant analytics :
 *      BookingAnalyticsSnapshot frozen=true pour 7d, 30d, 90d.
 *      Garantit que les métriques booking sont figées avant toute suppression.
 *
 *   2. Invariant légal :
 *      _backfillLegalProof.missingArchives === 0 dans chaque snapshot.
 *      Garantit que tous les bookings opérationnels ont une trace dans BookingLegalArchive.
 *      Cette preuve est calculée et embedée par freeze-booking-analytics-snapshot.ts
 *      au moment du gel, quand les tables booking sont encore présentes.
 *      Elle persiste dans le JSONB post-drop, sans nécessiter de migration.
 *
 *   Sans les deux invariants : état DECOMMISSIONED refusé.
 *
 * ── USAGE RGPD (gdpr-purge.service.ts) ───────────────────────────────────────
 *   P2021 sur Booking en RGPD Phase 3 :
 *     isBookingTableDropAllowed() = true  → skip archivage (tables légitimement absentes)
 *     isBookingTableDropAllowed() = false → BLOCK P0 (trace légale potentiellement perdue)
 *
 * ── USAGE ANALYTICS (reports.service.ts) ─────────────────────────────────────
 *   getBookingDecommissionPhase() :
 *     LIVE          → table snapshot peut ne pas exister (avant migration)
 *     FREEZE_ACTIVE → table snapshot doit exister (freeze script doit avoir tourné)
 *     DECOMMISSIONED → snapshot frozen=true + preuve légale obligatoires, jamais fallback live
 */

import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';

export type BookingDecommissionPhase =
  | 'LIVE'           // tables présentes, writes actifs
  | 'FREEZE_ACTIVE'  // writes bloqués (BOOKING_DISABLED=true), tables présentes
  | 'DECOMMISSIONED'; // tables supprimées ou drop autorisé

const REQUIRED_FROZEN_PERIODS = ['7d', '30d', '90d'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Type de la preuve légale embedée dans marketplaceJson
// ─────────────────────────────────────────────────────────────────────────────

export interface BackfillLegalProof {
  verifiedAt: string;    // ISO8601 — horodatage de la vérification
  totalBookings: number; // COUNT(Booking) au moment du gel
  totalArchives: number; // COUNT(BookingLegalArchive) au moment du gel
  missingArchives: number; // doit être 0 pour un état valide
}

/**
 * Extrait et valide la preuve légale depuis un objet JSON arbitraire.
 * Retourne null si la clé est absente ou malformée.
 */
export function extractBackfillLegalProof(json: unknown): BackfillLegalProof | null {
  if (json == null || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const proof = root['_backfillLegalProof'];
  if (proof == null || typeof proof !== 'object') return null;
  const p = proof as Record<string, unknown>;
  if (
    typeof p['verifiedAt'] !== 'string' ||
    typeof p['totalBookings'] !== 'number' ||
    typeof p['totalArchives'] !== 'number' ||
    typeof p['missingArchives'] !== 'number'
  ) {
    return null;
  }
  return {
    verifiedAt:     p['verifiedAt'] as string,
    totalBookings:  p['totalBookings'] as number,
    totalArchives:  p['totalArchives'] as number,
    missingArchives: p['missingArchives'] as number,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de phase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la phase de décommission courante.
 *
 * Priorité décroissante :
 *   1. BOOKING_DECOMMISSION_STATE=DECOMMISSIONED → DECOMMISSIONED
 *   2. BOOKING_DISABLED=true → FREEZE_ACTIVE
 *   3. Défaut → LIVE
 *
 * NODE_ENV n'est pas utilisé : l'état de décommission est orthogonal à l'environnement.
 */
export function getBookingDecommissionPhase(): BookingDecommissionPhase {
  if (process.env.BOOKING_DECOMMISSION_STATE === 'DECOMMISSIONED') {
    return 'DECOMMISSIONED';
  }
  if (process.env.BOOKING_DISABLED === 'true') {
    return 'FREEZE_ACTIVE';
  }
  return 'LIVE';
}

/**
 * Retourne true si et seulement si BOOKING_DECOMMISSION_STATE=DECOMMISSIONED.
 *
 * Ce test est intentionnellement strict : NODE_ENV=production ne suffit pas.
 * L'état DECOMMISSIONED doit être positionné manuellement APRÈS validation
 * des deux invariants (analytics + légal) par assertDecommissionedStateConsistent().
 */
export function isBookingTableDropAllowed(): boolean {
  return process.env.BOOKING_DECOMMISSION_STATE === 'DECOMMISSIONED';
}

// ─────────────────────────────────────────────────────────────────────────────
// Preflight au boot (Option A étendue)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preflight DB vérifiant la cohérence complète de l'état DECOMMISSIONED.
 *
 * À appeler au démarrage si BOOKING_DECOMMISSION_STATE=DECOMMISSIONED.
 * Requiert une connexion DB active.
 *
 * Vérifie les DEUX invariants indépendants :
 *
 *   1. Invariant analytics (preuve de gel des métriques) :
 *      → Tous les snapshots (7d, 30d, 90d) ont frozen=true
 *
 *   2. Invariant légal (preuve de couverture archive) :
 *      → Chaque snapshot contient _backfillLegalProof.missingArchives === 0
 *      → Cette preuve a été calculée par le freeze script quand les tables existaient
 *      → Elle est accessible post-drop sans requête sur les tables booking
 *
 * Comportements en cas d'échec :
 *   - Table snapshot absente (P2021/P2022) → throw PREFLIGHT_FAILED
 *   - Période non gelée → throw PREFLIGHT_FAILED (message: période concernée)
 *   - Preuve légale absente dans le JSON → throw PREFLIGHT_FAILED (message: re-run freeze)
 *   - missingArchives > 0 dans la preuve → throw PREFLIGHT_FAILED (message: run backfill)
 *   - Erreur DB inattendue → throw PREFLIGHT_FAILED (message: erreur brute)
 *
 * La boucle appelante (index.ts) fait process.exit(1) si cette fonction throw.
 */
export async function assertDecommissionedStateConsistent(): Promise<void> {
  if (!isBookingTableDropAllowed()) {
    return; // Pas en état DECOMMISSIONED — preflight non applicable
  }

  // ── 1. Lecture des snapshots ──────────────────────────────────────────────
  let snapshots: Array<{ period: string; frozen: boolean; marketplaceJson: unknown }>;
  try {
    snapshots = await prisma.bookingAnalyticsSnapshot.findMany({
      select: { period: true, frozen: true, marketplaceJson: true },
    });
  } catch (err: unknown) {
    const code = err != null && typeof err === 'object' && 'code' in err
      ? (err as Record<string, unknown>).code
      : undefined;
    if (code === 'P2021' || code === 'P2022') {
      throw new Error(
        'BOOKING_DECOMMISSION_PREFLIGHT_FAILED [ANALYTICS]: ' +
        'BOOKING_DECOMMISSION_STATE=DECOMMISSIONED mais la table BookingAnalyticsSnapshot est absente. ' +
        'La migration 20260413000000_add_booking_analytics_snapshot n\'a pas été appliquée, ' +
        'ou le script analytics:snapshot:freeze n\'a jamais tourné.',
      );
    }
    throw new Error(
      `BOOKING_DECOMMISSION_PREFLIGHT_FAILED [DB]: Erreur inattendue: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── 2. Invariant analytics : tous les snapshots doivent être gelés ────────
  const missingFrozen = REQUIRED_FROZEN_PERIODS.filter(
    (period) => !snapshots.find((s) => s.period === period && s.frozen),
  );

  if (missingFrozen.length > 0) {
    throw new Error(
      `BOOKING_DECOMMISSION_PREFLIGHT_FAILED [ANALYTICS]: ` +
      `Périodes sans snapshot gelé : [${missingFrozen.join(', ')}]. ` +
      `Exécuter: pnpm --filter @blobinfini/api analytics:snapshot:freeze`,
    );
  }

  // ── 3. Invariant légal : chaque snapshot doit contenir la preuve backfill ─
  for (const snapshot of snapshots.filter((s) =>
    REQUIRED_FROZEN_PERIODS.includes(s.period as typeof REQUIRED_FROZEN_PERIODS[number]),
  )) {
    const proof = extractBackfillLegalProof(snapshot.marketplaceJson);

    if (!proof) {
      // La preuve est absente : le freeze a été exécuté sans la vérification légale.
      // Cela arrive si le freeze a été lancé avec une version antérieure du script.
      throw new Error(
        `BOOKING_DECOMMISSION_PREFLIGHT_FAILED [LEGAL]: ` +
        `Le snapshot [${snapshot.period}] ne contient pas de preuve de backfill légal ` +
        `(_backfillLegalProof absent dans marketplaceJson). ` +
        `Re-exécuter: pnpm --filter @blobinfini/api analytics:snapshot:freeze --force`,
      );
    }

    if (proof.missingArchives !== 0) {
      // La preuve existe mais atteste d'archives manquantes au moment du gel.
      // État incohérent : le freeze aurait dû bloquer. Ne jamais atteindre cette branche
      // en conditions normales (le freeze ne gèle que si missingArchives === 0).
      throw new Error(
        `BOOKING_DECOMMISSION_PREFLIGHT_FAILED [LEGAL]: ` +
        `Le snapshot [${snapshot.period}] atteste ${proof.missingArchives} booking(s) ` +
        `sans archive légale au moment du gel (${proof.verifiedAt}). ` +
        `totalBookings=${proof.totalBookings}, totalArchives=${proof.totalArchives}. ` +
        `Exécuter le backfill puis re-geler: ` +
        `pnpm --filter @blobinfini/api backfill:booking-archive:execute && ` +
        `pnpm --filter @blobinfini/api analytics:snapshot:freeze --force`,
      );
    }
  }

  // ── 4. Les deux invariants sont vérifiés ──────────────────────────────────
  const proofSummary = snapshots
    .filter((s) => REQUIRED_FROZEN_PERIODS.includes(s.period as typeof REQUIRED_FROZEN_PERIODS[number]))
    .map((s) => {
      const proof = extractBackfillLegalProof(s.marketplaceJson);
      return { period: s.period, totalBookings: proof?.totalBookings, verifiedAt: proof?.verifiedAt };
    });

  secureLogger.info('BOOKING_DECOMMISSION_PREFLIGHT_OK', {
    phase: 'DECOMMISSIONED',
    analyticsInvariant: 'frozen=true for 7d/30d/90d',
    legalInvariant: 'missingArchives=0 for all periods',
    proofSummary,
  });
}
