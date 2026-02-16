/**
 * WebSocket Reconnection Storm Guard (P0 Step 2)
 *
 * PROTECTION:
 * - Limite nombre de connexions par userId sur une fenêtre glissante
 * - Appliqué AVANT query DB (économie ressources)
 * - Erreurs neutres (pas de détails techniques)
 *
 * DESIGN:
 * - RateLimiterMemory (pas de dépendance Redis)
 * - Fenêtre glissante 60s
 * - Default: 20 connexions/60s (configurable)
 *
 * LIMITATION:
 * - Tracking en mémoire = limite par instance
 * - Multi-instances: limite effective = limite × nb instances
 * - Solution P1: Redis pour tracking global
 */

import { RateLimiterMemory } from 'rate-limiter-flexible';
import { secureLogger } from '../utils/secure-logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

const RECONNECT_WINDOW_SEC = Number(process.env.WS_RECONNECT_WINDOW_SEC || '60');
const MAX_RECONNECTS_PER_WINDOW = Number(process.env.WS_MAX_RECONNECTS || '20');

// Durée du blocage après dépassement (secondes)
const BLOCK_DURATION_SEC = Number(process.env.WS_RECONNECT_BLOCK_SEC || '60');

// ============================================================================
// RATE LIMITER
// ============================================================================

/**
 * Rate limiter pour connexions WebSocket
 *
 * - points: nombre max de connexions autorisées
 * - duration: fenêtre de temps (secondes)
 * - blockDuration: durée du ban après dépassement
 */
const reconnectionLimiter = new RateLimiterMemory({
  points: MAX_RECONNECTS_PER_WINDOW,
  duration: RECONNECT_WINDOW_SEC,
  blockDuration: BLOCK_DURATION_SEC
});

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Vérifie si une connexion est autorisée (rate limit reconnection)
 *
 * IMPORTANT: Appeler AVANT toute query DB
 *
 * @param userId - ID utilisateur (depuis JWT décodé, pas encore vérifié en DB)
 * @returns null si OK, string avec message d'erreur neutre si bloqué
 */
export async function checkReconnectionAllowed(userId: string): Promise<string | null> {
  try {
    // Consommer 1 point (= 1 connexion)
    await reconnectionLimiter.consume(userId);
    return null; // OK, connexion autorisée
  } catch (error: any) {
    // Cas 1: Rate limit dépassé (comportement normal)
    if (error.msBeforeNext !== undefined) {
      const retryAfter = Math.ceil(error.msBeforeNext / 1000);

      secureLogger.warn('WS_RECONNECT_STORM_BLOCKED', {
        userId,
        retryAfter,
        limit: MAX_RECONNECTS_PER_WINDOW,
        window: RECONNECT_WINDOW_SEC
      });

      // Erreur publique neutre (pas de détails techniques)
      return 'Connection rate limit exceeded';
    }

    // Cas 2: Erreur inattendue (ne devrait pas arriver avec RateLimiterMemory)
    // P0 STEP 2.1: Log explicite pour investigation
    secureLogger.error('WS_RECONNECT_GUARD_UNEXPECTED_ERROR', {
      userId,
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorStack: error instanceof Error ? error.stack : undefined,
      action: 'fail-open (connection allowed)',
      mitigation: 'maxConnPerUser still active'
    });

    // FAIL-OPEN: Autoriser en cas d'erreur interne (ne pas bloquer service)
    // Mitigation: maxConnPerUser (Step 1) reste actif pour limiter dégâts
    return null;
  }
}

/**
 * Métriques pour observabilité
 */
export function getReconnectionMetrics() {
  return {
    maxReconnects: MAX_RECONNECTS_PER_WINDOW,
    windowSec: RECONNECT_WINDOW_SEC,
    blockDurationSec: BLOCK_DURATION_SEC
  };
}

/**
 * Reset rate limit pour un user (utile pour tests)
 * NE PAS UTILISER EN PRODUCTION
 */
export async function resetReconnectionLimit(userId: string): Promise<void> {
  try {
    await reconnectionLimiter.delete(userId);
  } catch (error) {
    // Ignore errors
  }
}
