/**
 * booking-disabled.ts
 *
 * Guard hard-fail pour le décommissionnement du module booking.
 *
 * RÈGLES DE CONCEPTION :
 *   - Liste explicite des paths écriture (pas de pattern générique) — conservative by design
 *   - 410 Gone (pas 404) : indique une suppression intentionnelle, pas une ressource absente
 *   - Log structuré de chaque tentative bloquée pour preuve d'absence d'activité
 *   - Actif si BOOKING_DISABLED=true OU NODE_ENV=production (post-décommission)
 *   - Lire (GET) n'est pas bloqué : les données historiques restent consultables par les services internes
 *
 * MONTAGE : après csrfProtection, avant les routers — cf. createApp() dans index.ts
 */

import type { Request, Response, NextFunction } from 'express';
import { secureLogger } from '../utils/secure-logger';

// ─────────────────────────────────────────────────────────────────────────────
// Liste exhaustive des opérations d'écriture booking encore potentiellement
// accessibles. Basée sur l'audit des routes supprimées + paths de l'ancien router.
// Mettre à jour si de nouveaux paths écriture sont découverts.
// ─────────────────────────────────────────────────────────────────────────────

const BOOKING_WRITE_RULES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  // Ancien booking router
  { method: 'POST',   pattern: /^\/bookings(?:\/|$)/ },
  { method: 'PATCH',  pattern: /^\/bookings\/[^/]+/ },
  { method: 'DELETE', pattern: /^\/bookings\/[^/]+/ },
  // Ancien booking-request router
  { method: 'POST',   pattern: /^\/booking-requests(?:\/|$)/ },
  { method: 'PATCH',  pattern: /^\/booking-requests\/[^/]+/ },
  // Pro availability (écriture)
  { method: 'POST',   pattern: /^\/pro\/availability(?:\/|$)/ },
  { method: 'PUT',    pattern: /^\/pro\/availability\/[^/]+/ },
  { method: 'PATCH',  pattern: /^\/pro\/availability\/[^/]+/ },
  { method: 'DELETE', pattern: /^\/pro\/availability\/[^/]+/ },
  // Manual booking (ancien endpoint pro)
  { method: 'POST',   pattern: /^\/pro\/bookings(?:\/|$)/ },
  // Interactions (view/click tracking — plus de writer côté API)
  { method: 'POST',   pattern: /^\/pro\/availability\/[^/]+\/interact(?:\/|$)/ },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper de détection
// ─────────────────────────────────────────────────────────────────────────────

export function isBookingWritePath(method: string, path: string): boolean {
  return BOOKING_WRITE_RULES.some(
    (rule) => rule.method === method && rule.pattern.test(path),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bloque toute tentative d'écriture booking avec 410 Gone.
 *
 * Actif si et seulement si BOOKING_DISABLED=true.
 *
 * NODE_ENV n'est PAS utilisé : NODE_ENV=production décrit l'environnement
 * d'exécution, pas l'état du module booking. Le freeze des writes est
 * une décision ops explicite, indépendante de l'environnement.
 *
 * Séquence attendue :
 *   1. LOT A mergé et déployé → BOOKING_DISABLED absent → guard inactif
 *   2. Ops positionne BOOKING_DISABLED=true → guard actif → 410 sur toute écriture
 *   3. Backfill + freeze → BOOKING_DECOMMISSION_STATE=DECOMMISSIONED → LOT B
 */
export function bookingDisabledGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const disabled = process.env.BOOKING_DISABLED === 'true';

  if (disabled && isBookingWritePath(req.method, req.path)) {
    secureLogger.warn('BOOKING_WRITE_BLOCKED_DECOMMISSION', {
      method: req.method,
      // req.path normalisé par Express — pas d'injection possible via path traversal
      path: req.path,
    });
    res.status(410).json({
      error: 'BOOKING_FEATURE_REMOVED',
      message: 'Le module booking a été supprimé. Aucune nouvelle donnée de réservation ne peut être créée.',
    });
    return;
  }

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Prisma error — détecte l'absence de table après drop
// Exporté pour réutilisation dans gdpr-export et gdpr-purge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne true si l'erreur indique qu'une table n'existe plus en base.
 *
 * Codes Prisma couverts :
 *   P2021 — "The table {table} does not exist in the current database."
 *   P2022 — "The column {column} does not exist in the current database."
 *
 * IMPORTANT : ne PAS utiliser pour masquer d'autres erreurs.
 * Toujours re-throw si ce n'est pas une erreur de table manquante.
 */
/**
 * Extrait le code Prisma d'une erreur inconnue.
 * Pattern cohérent avec le reste du codebase (cf. matching.controller.ts:210).
 */
function getPrismaCode(err: unknown): string | undefined {
  if (err != null && typeof err === 'object' && 'code' in err) {
    const code = (err as Record<string, unknown>).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function isTableGoneError(err: unknown): boolean {
  // P2021 — "The table {table} does not exist in the current database."
  // P2022 — "The column {column} does not exist in the current database."
  const code = getPrismaCode(err);
  if (code === 'P2021' || code === 'P2022') return true;

  // Fallback : certaines versions de Prisma wrappent l'erreur PostgreSQL 42P01
  // (undefined_table) dans un message sans code structuré
  if (err instanceof Error) {
    return err.message.includes('42P01');
  }
  return false;
}
