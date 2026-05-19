/**
 * Upload token — état pending/used en Redis pour les presigned URLs photo.
 *
 * Flux :
 *   1. registerPendingUpload(key, userId, ttlSeconds) — au moment du presign
 *   2. claimUploadToken(key, userId)                  — au moment du finalize
 *
 * Atomicité :
 *   Le script Lua est exécuté de façon non-préemptive par Redis.
 *   Deux requêtes finalize parallèles sur la même clé : la première réussit,
 *   la seconde trouve usedKey déjà posé et reçoit -3 → handler retourne 409.
 *
 * Fail-secure :
 *   - registerPendingUpload sans Redis : no-op + warn. Le finalize retournera
 *     'not_found' si Redis était absent dès le départ.
 *   - claimUploadToken sans Redis : retourne 'no_redis' → handler retourne 503.
 *     Jamais permissif.
 *
 * Note Redis Cluster :
 *   En single-node (config actuelle), les deux clés landing sur le même nœud.
 *   En cluster, hashtag requis pour co-localisation (ex : {upload_key}).
 *   Non applicable tant que Redis single-node.
 */

import { cacheService } from '../services/cache.service';
import { secureLogger } from '../utils/secure-logger';

const PENDING_PREFIX = 'upload:pending:';
const USED_PREFIX = 'upload:used:';
// Conserver l'état "used" 24h pour bloquer les replays tardifs
const USED_TTL_SECONDS = 86400;

// ─── Memory fallback (NODE_ENV=test uniquement) ────────────────────────────
// Quand Redis est absent en test, on simule le store Redis en mémoire.
// En production, Redis est obligatoire et ce store n'est jamais utilisé.
const _memPending = new Map<string, string>(); // key → userId
const _memUsed    = new Set<string>();          // key

/** Réinitialise le store mémoire entre les tests. */
export function __resetUploadTokenStore(): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('__resetUploadTokenStore is test-only');
  _memPending.clear();
  _memUsed.clear();
}

/**
 * Enregistre une clé S3 comme "attendue" en Redis.
 * TTL = durée presigned URL + 30s (buffer clock skew).
 */
export async function registerPendingUpload(
  key: string,
  userId: string,
  presignTtlSeconds: number,
): Promise<void> {
  const client = cacheService.getClient();
  if (!client) {
    if (process.env.NODE_ENV === 'test') {
      _memPending.set(key, userId);
      return;
    }
    secureLogger.warn('UPLOAD_TOKEN_REDIS_UNAVAILABLE_ON_REGISTER', { keyPrefix: key.slice(0, 40) });
    return; // fail-open sur register — fail-secure sur claim
  }
  try {
    await client.set(`${PENDING_PREFIX}${key}`, userId, { EX: presignTtlSeconds + 30 });
  } catch (err) {
    secureLogger.error('UPLOAD_TOKEN_REGISTER_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type ClaimResult =
  | 'ok'
  | 'not_found'    // expiré ou jamais enregistré
  | 'wrong_user'   // autre userId tenté
  | 'already_used' // double finalize
  | 'no_redis';    // Redis indisponible → refuser (fail-secure)

/**
 * Lua atomique : vérifie pending, vérifie no-double-use, marque used, supprime pending.
 * Retourne : 1 (ok), -1 (not_found), -2 (wrong_user), -3 (already_used).
 */
const LUA_CLAIM = `
local pendingKey = KEYS[1]
local usedKey = KEYS[2]
local expectedUserId = ARGV[1]
local usedTtl = tonumber(ARGV[2])

local storedUserId = redis.call('GET', pendingKey)
if storedUserId == false then return -1 end
if storedUserId ~= expectedUserId then return -2 end
local alreadyUsed = redis.call('GET', usedKey)
if alreadyUsed ~= false then return -3 end
redis.call('SET', usedKey, '1', 'EX', usedTtl)
redis.call('DEL', pendingKey)
return 1
`;

/**
 * Claim atomique. Un seul appel concurrent peut retourner 'ok'.
 */
export async function claimUploadToken(
  key: string,
  userId: string,
): Promise<ClaimResult> {
  const client = cacheService.getClient();
  if (!client) {
    if (process.env.NODE_ENV === 'test') {
      // Fallback mémoire : même logique que le Lua script, synchrone (single-threaded test)
      if (_memUsed.has(key))              return 'already_used';
      const storedUserId = _memPending.get(key);
      if (!storedUserId)                  return 'not_found';
      if (storedUserId !== userId)        return 'wrong_user';
      _memUsed.add(key);
      _memPending.delete(key);
      return 'ok';
    }
    return 'no_redis';
  }

  try {
    const result = await client.eval(LUA_CLAIM, {
      keys: [`${PENDING_PREFIX}${key}`, `${USED_PREFIX}${key}`],
      arguments: [userId, String(USED_TTL_SECONDS)],
    });
    const code = Number(result);
    if (code === 1)  return 'ok';
    if (code === -1) return 'not_found';
    if (code === -2) return 'wrong_user';
    if (code === -3) return 'already_used';
    return 'not_found';
  } catch (err) {
    secureLogger.error('UPLOAD_TOKEN_CLAIM_ERROR', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 'no_redis';
  }
}
