/**
 * Per-user decisions quota — Redis-primary, DB-fallback.
 *
 * Multi-instance safety:
 *   The Redis path uses a Lua script executed atomically by the Redis server.
 *   No other command can interleave between the GETs and the INCRBY, so two
 *   concurrent API instances cannot both pass the quota check when only one
 *   slot remains.
 *
 * Sliding window (anti-double-dip):
 *   Uses a 2-bucket sliding window approximation. Each "bucket" is a fixed-width
 *   period (windowHours). The effective count combines the current bucket and a
 *   weighted fraction of the previous bucket:
 *
 *     effective = current + previous × (1 − elapsed / period)
 *
 *   At the start of a new window (elapsed ≈ 0), previous counts fully.
 *   At the midpoint, previous counts 50%. At the end, previous counts ~0%.
 *   This eliminates the "double-dip" burst at midnight UTC that a fixed-window
 *   approach allows (up to 2× quota in 1 second at the boundary).
 *
 * DB fallback:
 *   When Redis is unavailable (no cacheService client, or Lua returns a
 *   non-numeric value from a mock), we fall back to a COUNT query inside the
 *   Prisma transaction.  This is NOT atomic across instances but is acceptable
 *   in degraded mode — quota is a soft abuse guard, not a billing hard cap.
 *
 * Key schema:
 *   quota:match:decisions:{userId}:{windowTag}
 *   where windowTag is the UTC timestamp of the window start (YYYYMMDDHHMMSS format),
 *   truncated to the configured window boundary.
 *   Example (windowHours=1): quota:match:decisions:abc123:20260303143000
 *
 * TTL:
 *   windowHours * 3600 + 60s buffer (for clock skew / Redis eviction lag).
 *   A 60-second buffer ensures the key is not evicted while still in the window.
 *
 * Security:
 *   - No PII is logged.  The key contains userId (internal UUID) — acceptable.
 *   - The Lua script returns -1 on exceeded; callers throw before any DB write.
 *   - Env vars MATCHING_DECISIONS_QUOTA_MAX / MATCHING_DECISIONS_QUOTA_WINDOW_HOURS
 *     must both be set to enable quota.  Missing either disables quota (fail-open).
 */

import type { Prisma } from '@blobinfini/database';
import { cacheService } from '../services/cache.service';

// ─────────────────────────────────────────────────────────────────────────────
// Window key helpers
// ─────────────────────────────────────────────────────────────────────────────

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * Returns the Redis quota key for a given userId and window boundary.
 *
 * @param userId      Internal user UUID (not PII in this context — internal only).
 * @param windowHours Window duration in hours.
 * @param nowMs       Current epoch ms.  Defaults to Date.now() — injectable for tests.
 */
export function getQuotaWindowKey(
  userId: string,
  windowHours: number,
  nowMs: number = Date.now(),
): string {
  const windowMs = windowHours * 3_600_000;
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const tag = [
    windowStart.getUTCFullYear(),
    pad2(windowStart.getUTCMonth() + 1),
    pad2(windowStart.getUTCDate()),
    pad2(windowStart.getUTCHours()),
    pad2(windowStart.getUTCMinutes()),
    pad2(windowStart.getUTCSeconds()),
  ].join('');
  return `quota:match:decisions:${userId}:${tag}`;
}

/**
 * Returns both the current and previous window keys, plus elapsed time info
 * needed for the sliding window Lua script.
 *
 * Exported for unit tests.
 */
export function getQuotaWindowKeys(
  userId: string,
  windowHours: number,
  nowMs: number = Date.now(),
): { currentKey: string; prevKey: string; elapsedMs: number; periodMs: number } {
  const periodMs = windowHours * 3_600_000;
  const windowStartMs = Math.floor(nowMs / periodMs) * periodMs;
  const elapsedMs = nowMs - windowStartMs;
  const prevWindowStartMs = windowStartMs - periodMs;

  const currentKey = getQuotaWindowKey(userId, windowHours, nowMs);
  // Any timestamp inside the previous window works — use its start.
  const prevKey = getQuotaWindowKey(userId, windowHours, prevWindowStartMs);

  return { currentKey, prevKey, elapsedMs, periodMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lua scripts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sliding window quota check + increment (atomic).
 *
 * KEYS[1] = current bucket key
 * KEYS[2] = previous bucket key
 * ARGV[1] = delta        (items to add)
 * ARGV[2] = max          (quota limit)
 * ARGV[3] = ttl          (current bucket TTL in seconds)
 * ARGV[4] = elapsedMs    (ms elapsed in current period — integer)
 * ARGV[5] = periodMs     (ms per period — integer)
 *
 * Returns -1 if quota would be exceeded (counter NOT incremented).
 * Returns new counter value otherwise (TTL set on first write).
 *
 * Sliding formula: effective = current + prev × (1 − elapsed/period)
 * This eliminates the double-dip at fixed-window boundaries.
 */
const QUOTA_SLIDING_LUA = `
local delta   = tonumber(ARGV[1])
local max     = tonumber(ARGV[2])
local ttl     = tonumber(ARGV[3])
local elapsed = tonumber(ARGV[4])
local period  = tonumber(ARGV[5])

local current = tonumber(redis.call('GET', KEYS[1])) or 0
local prev    = tonumber(redis.call('GET', KEYS[2])) or 0

local prevWeight = 1 - elapsed / period
local effective  = current + prev * prevWeight

if effective + delta > max then
  return -1
end

local newval = redis.call('INCRBY', KEYS[1], delta)
if newval == delta then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return newval
`;

/**
 * Safe DECRBY: only decrements if the key exists and current value > 0.
 * Prevents creating negative counters or keys that don't exist yet.
 * Preserves the existing TTL.
 *
 * KEYS[1] = key to decrement
 * ARGV[1] = delta (amount to subtract)
 *
 * Returns new value, or 0 if key absent / already at 0.
 */
const REFUND_LUA = `
local key   = KEYS[1]
local delta = tonumber(ARGV[1])
local raw   = redis.call('GET', key)
if not raw then return 0 end

local current = tonumber(raw) or 0
if current <= 0 then return 0 end

local remaining_ttl = redis.call('TTL', key)
local newval = math.max(0, current - delta)
redis.call('SET', key, newval)
if remaining_ttl > 0 then
  redis.call('EXPIRE', key, remaining_ttl)
end
return newval
`;

// ─────────────────────────────────────────────────────────────────────────────
// Redis path
// ─────────────────────────────────────────────────────────────────────────────

async function checkWithRedis(
  redis: NonNullable<ReturnType<typeof cacheService.getClient>>,
  userId: string,
  newItemsCount: number,
  max: number,
  windowHours: number,
  nowMs: number,
): Promise<'ok' | 'exceeded' | 'fallback'> {
  const { currentKey, prevKey, elapsedMs, periodMs } = getQuotaWindowKeys(userId, windowHours, nowMs);
  const ttl = windowHours * 3600 + 60; // buffer for clock skew

  let result: unknown;
  try {
    result = await (redis as any).eval(QUOTA_SLIDING_LUA, {
      keys: [currentKey, prevKey],
      arguments: [
        String(newItemsCount),
        String(max),
        String(ttl),
        String(Math.floor(elapsedMs)),
        String(periodMs),
      ],
    });
  } catch {
    // Redis error (timeout, network) → fall through to DB
    return 'fallback';
  }

  if (typeof result !== 'number') {
    // Non-numeric result (e.g., test mock returning 'VALID') → DB fallback
    return 'fallback';
  }
  return result === -1 ? 'exceeded' : 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// DB fallback (single-instance safe; multi-instance: best-effort)
// ─────────────────────────────────────────────────────────────────────────────

async function checkWithDb(
  tx: Prisma.TransactionClient,
  userId: string,
  newItemsCount: number,
  max: number,
  windowHours: number,
  nowMs: number,
): Promise<'ok' | 'exceeded'> {
  const windowStart = new Date(nowMs - windowHours * 3_600_000);
  const existing = await tx.matchDecision.count({
    where: { actorUserId: userId, createdAt: { gte: windowStart } },
  });
  return existing + newItemsCount > max ? 'exceeded' : 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enforces the per-user decisions quota.
 *
 * Called inside a Prisma $transaction so that a throw here rolls back any DB
 * writes that would otherwise follow.  The Redis increment (if taken) is NOT
 * rolled back on transaction failure — callers must invoke refundDecisionsQuota()
 * in the catch block if the error is a server-side fault (5xx).
 *
 * @param nowMs Injectable clock for testing — defaults to Date.now().
 *
 * Throws `{ code: 'QUOTA_EXCEEDED' }` when the quota is breached.
 * Returns `undefined` (void) when the request is within quota.
 * Returns `undefined` (fail-open) when the quota feature is disabled (env vars absent).
 */
export async function checkDecisionsQuota(
  tx: Prisma.TransactionClient,
  userId: string,
  newItemsCount: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const maxStr = process.env.MATCHING_DECISIONS_QUOTA_MAX;
  const windowHoursStr = process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
  if (!maxStr || !windowHoursStr) return; // feature disabled

  const max = parseInt(maxStr, 10);
  const windowHours = parseInt(windowHoursStr, 10);
  if (isNaN(max) || isNaN(windowHours)) return; // malformed env — fail open

  const redis = cacheService.getClient();

  let outcome: 'ok' | 'exceeded';

  if (redis) {
    const redisResult = await checkWithRedis(redis, userId, newItemsCount, max, windowHours, nowMs);
    if (redisResult === 'fallback') {
      // Redis path unavailable (non-numeric response or error) → DB fallback
      outcome = await checkWithDb(tx, userId, newItemsCount, max, windowHours, nowMs);
    } else {
      outcome = redisResult;
    }
  } else {
    outcome = await checkWithDb(tx, userId, newItemsCount, max, windowHours, nowMs);
  }

  if (outcome === 'exceeded') {
    throw Object.assign(new Error('Quota exceeded'), { code: 'QUOTA_EXCEEDED' });
  }
}

/**
 * Best-effort quota refund: DECRBY the Redis counter by `count`.
 *
 * Called in catch blocks when a server-side error (5xx) caused the transaction
 * to abort AFTER the quota was incremented in Redis.  This prevents the user
 * from being penalised for server faults.
 *
 * If Redis is unavailable, this is a no-op — the DB quota was part of the
 * rolled-back transaction and needs no separate refund.
 *
 * If Redis eval fails (network), the error is swallowed — the counter will
 * expire naturally at the window TTL (best-effort guard, not a hard ledger).
 *
 * @param nowMs Injectable clock for testing — defaults to Date.now().
 */
export async function refundDecisionsQuota(
  userId: string,
  count: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const windowHoursStr = process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
  if (!windowHoursStr) return; // feature disabled

  const windowHours = parseInt(windowHoursStr, 10);
  if (isNaN(windowHours)) return;

  const redis = cacheService.getClient();
  if (!redis) return; // DB path — TX rollback already reversed the quota

  const { currentKey } = getQuotaWindowKeys(userId, windowHours, nowMs);
  try {
    await (redis as any).eval(REFUND_LUA, {
      keys: [currentKey],
      arguments: [String(count)],
    });
  } catch {
    // Best-effort — counter expires with window TTL if Redis is unreachable.
  }
}
