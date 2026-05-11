/**
 * session-store.ts — Fabrique de session store pour express-session.
 *
 * Règles :
 * - test       : MemoryStore (Redis non initialisé)
 * - dev        : MemoryStore avec warning si Redis absent, RedisStore si disponible
 * - production : RedisStore obligatoire — throw si Redis non connecté
 *
 * Ce module ne doit jamais logger de sessionId, cookie ni token.
 *
 * Appelé APRÈS redisClientInitPromise en production (voir index.ts)
 * pour garantir que getRedisClient() retourne un client connecté.
 */

import type { Store } from 'express-session';
import { RedisStore } from 'connect-redis';
import { getRedisClient } from './redis-client';
import { secureLogger } from '../utils/secure-logger';

export function buildSessionStore(): Store | undefined {
  const client = getRedisClient();

  if (client) {
    // connect-redis v7 — compatible redis v5
    const store = new RedisStore({
      client,
      prefix: 'sess:',
      ttl: 24 * 60 * 60, // 24h — cohérent avec cookie.maxAge
    });
    secureLogger.info('SESSION_STORE_REDIS_ACTIVE');
    return store;
  }

  if (process.env.NODE_ENV === 'production') {
    // En production, buildSessionStore() est appelé APRÈS redisClientInitPromise.
    // Si on arrive ici, Redis a échoué à connecter mais process.exit(1) n'a pas
    // été appelé — situation anormale, on refuse de démarrer.
    throw new Error(
      'FATAL: SESSION_STORE_REDIS_UNAVAILABLE — Redis non connecté en production. ' +
      'Vérifier redis-client.ts : process.exit(1) aurait dû être appelé avant.'
    );
  }

  if (process.env.NODE_ENV !== 'test') {
    secureLogger.warn('SESSION_STORE_MEMORY_FALLBACK', {
      reason: 'Redis non disponible — MemoryStore utilisé (non adapté à la production)',
    });
  }

  // MemoryStore par défaut d'express-session (undefined = MemoryStore implicite)
  return undefined;
}
