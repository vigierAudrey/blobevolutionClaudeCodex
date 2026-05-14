/**
 * WebSocket Auth Cache (P0 Step 2)
 *
 * OBJECTIF:
 * - Réduire charge DB sur authenticateSocket
 * - Cache en mémoire TTL court (30-60s)
 * - Pas d'invalidation active (TTL suffit)
 *
 * DESIGN:
 * - Map<userId, {exists, role, expiresAt}>
 * - get() → if expired, delete et return null
 * - TTL court (30-60s) → pas besoin d'invalidation complexe
 *
 * SÉCURITÉ:
 * - TTL court → user deleted/role change détecté rapidement
 * - Fallback DB si cache miss
 * - Pas de PII en cache (userId déjà connu par JWT)
 *
 * LIMITATION:
 * - Cache par instance (pas global)
 * - Multi-instances: chaque instance a son cache
 * - Hit rate réduit sur multi-instances (acceptable pour P0)
 */

import { secureLogger } from '../utils/secure-logger';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CACHE_TTL_MS = Number(process.env.WS_AUTH_CACHE_TTL_MS || '30000'); // Default: 30s
const ENABLE_CACHE = process.env.WS_AUTH_CACHE_ENABLED !== 'false'; // Default: ON

// ============================================================================
// TYPES
// ============================================================================

interface CacheEntry {
  exists: boolean;
  role?: string; // undefined si exists=false
  sessionVersion?: number; // undefined si exists=false ou token legacy sans sv
  expiresAt: number; // timestamp ms
}

// ============================================================================
// CACHE STORAGE
// ============================================================================

/**
 * Cache en mémoire
 * Map<userId, CacheEntry>
 */
const cache = new Map<string, CacheEntry>();

/**
 * Stats pour métriques
 */
let stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  evictions: 0
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Récupère une entrée du cache
 *
 * @param userId - ID utilisateur
 * @returns CacheEntry si trouvé et valide, null sinon
 */
export function getCachedAuth(userId: string): CacheEntry | null {
  if (!ENABLE_CACHE) {
    return null;
  }

  const entry = cache.get(userId);

  if (!entry) {
    stats.misses++;
    return null;
  }

  // Vérifier expiration
  const now = Date.now();
  if (now >= entry.expiresAt) {
    // Expiré → supprimer
    cache.delete(userId);
    stats.evictions++;
    stats.misses++;
    return null;
  }

  // Cache hit
  stats.hits++;
  return entry;
}

/**
 * Met en cache une entrée auth
 *
 * @param userId - ID utilisateur
 * @param exists - Utilisateur existe en DB ?
 * @param role - Rôle utilisateur (si exists=true)
 * @param sessionVersion - sessionVersion lu depuis la DB (si exists=true)
 */
export function setCachedAuth(userId: string, exists: boolean, role?: string, sessionVersion?: number): void {
  if (!ENABLE_CACHE) {
    return;
  }

  const expiresAt = Date.now() + CACHE_TTL_MS;

  cache.set(userId, {
    exists,
    role: exists ? role : undefined,
    sessionVersion: exists ? sessionVersion : undefined,
    expiresAt
  });

  stats.sets++;
}

/**
 * Invalide une entrée du cache (utile si user deleted/role changed)
 *
 * NOTE: Pas utilisé en P0 (TTL court suffit), mais API disponible pour P1
 */
export function invalidateCachedAuth(userId: string): void {
  if (cache.delete(userId)) {
    stats.evictions++;
  }
}

/**
 * Métriques pour observabilité
 */
export function getAuthCacheMetrics() {
  const totalRequests = stats.hits + stats.misses;
  const hitRate = totalRequests > 0 ? (stats.hits / totalRequests * 100).toFixed(2) : '0.00';

  return {
    enabled: ENABLE_CACHE,
    ttlMs: CACHE_TTL_MS,
    size: cache.size,
    hits: stats.hits,
    misses: stats.misses,
    sets: stats.sets,
    evictions: stats.evictions,
    hitRate: `${hitRate}%`
  };
}

/**
 * Nettoyage périodique des entrées expirées
 *
 * Appelé toutes les 60s pour éviter memory leak
 * (entrées expirées non accédées restent en mémoire)
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  let cleaned = 0;

  // Utiliser Array.from pour compatibilité TS
  Array.from(cache.entries()).forEach(([userId, entry]) => {
    if (now >= entry.expiresAt) {
      cache.delete(userId);
      cleaned++;
    }
  });

  if (cleaned > 0) {
    stats.evictions += cleaned;
    secureLogger.debug('WS_AUTH_CACHE_CLEANUP', {
      cleaned,
      remaining: cache.size
    });
  }
}

// Cleanup automatique toutes les 60s
let cleanupInterval: NodeJS.Timeout | null = null;

if (ENABLE_CACHE && process.env.NODE_ENV !== 'test') {
  cleanupInterval = setInterval(cleanupExpiredEntries, 60000);
  cleanupInterval.unref();

  secureLogger.info('WS_AUTH_CACHE_ENABLED', {
    ttlMs: CACHE_TTL_MS,
    cleanupIntervalMs: 60000
  });
}

/**
 * Stop cleanup interval (pour tests)
 */
export function stopAuthCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Reset cache (utile pour tests)
 */
export function resetAuthCache(): void {
  cache.clear();
  stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
}
