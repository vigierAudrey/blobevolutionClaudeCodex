/**
 * Unit tests for the per-user decisions quota module (matching-quota.ts).
 *
 * These tests run without DB and without HTTP — they test the quota logic
 * in isolation by mocking cacheService (Redis path) and the Prisma tx (DB path).
 *
 * Coverage:
 *   A) getQuotaWindowKey: same window → same key; different window → different key;
 *      userA key ≠ userB key (cross-user isolation proof).
 *   B) Redis path: quota OK → no throw; quota exceeded → QUOTA_EXCEEDED;
 *      non-numeric eval result → DB fallback triggered.
 *   C) DB fallback path: quota OK → no throw; quota exceeded → QUOTA_EXCEEDED.
 *   D) Window reset: key changes after window boundary → fresh quota.
 *   E) Cross-user isolation: userA quota does NOT affect userB.
 *   F) Feature flag: missing env vars → always OK (fail-open).
 *   G) Sliding window: getQuotaWindowKeys structure + boundary weights.
 *   H) refundDecisionsQuota: DECRBY called on Redis; no-op when Redis absent.
 *   I) isServerError: classification of 4xx vs 5xx error types.
 */

// jest.mock MUST come before import to ensure the module factory runs first.
jest.mock('../../../services/cache.service', () => ({
  cacheService: { getClient: jest.fn() },
}));

import {
  getQuotaWindowKey,
  getQuotaWindowKeys,
  checkDecisionsQuota,
  refundDecisionsQuota,
} from '../../../lib/matching-quota';
import { isServerError } from '../../matching/matching.controller';
import { cacheService } from '../../../services/cache.service';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns a minimal mock Prisma tx with a controllable matchDecision.count. */
function makeMockTx(existingCount: number) {
  return {
    matchDecision: {
      count: jest.fn().mockResolvedValue(existingCount),
    },
  } as unknown as Parameters<typeof checkDecisionsQuota>[0];
}

/** Returns a mock Redis client where eval resolves to `value`. */
function makeRedisWithEval(value: unknown) {
  return { eval: jest.fn().mockResolvedValue(value) };
}

/** Returns a mock Redis client where eval rejects (simulates network error). */
function makeRedisWithEvalError() {
  return { eval: jest.fn().mockRejectedValue(new Error('Redis timeout')) };
}

// Suppress cacheService import in the module under test by pointing getClient to null
function mockRedisNull() {
  (cacheService.getClient as jest.Mock).mockReturnValue(null);
}

function mockRedisClient(client: object) {
  (cacheService.getClient as jest.Mock).mockReturnValue(client);
}

const USER_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const USER_B = 'bbbbbbbb-0000-4000-8000-000000000002';

// ─────────────────────────────────────────────────────────────────────────────
// A) getQuotaWindowKey: isolation proofs
// ─────────────────────────────────────────────────────────────────────────────

describe('getQuotaWindowKey — window isolation', () => {
  const NOW = new Date('2026-03-03T14:30:00Z').getTime();
  const WINDOW_HOURS = 24;
  const ONE_DAY_MS = 24 * 3600 * 1000;

  it('same userId + same timestamp → identical key (idempotent)', () => {
    const k1 = getQuotaWindowKey(USER_A, WINDOW_HOURS, NOW);
    const k2 = getQuotaWindowKey(USER_A, WINDOW_HOURS, NOW);
    expect(k1).toBe(k2);
  });

  it('same userId + timestamp in same window → same key', () => {
    // Both are in the same 24h window (2026-03-03T00:00Z boundary)
    const t1 = new Date('2026-03-03T00:00:01Z').getTime();
    const t2 = new Date('2026-03-03T23:59:59Z').getTime();
    expect(getQuotaWindowKey(USER_A, WINDOW_HOURS, t1)).toBe(
      getQuotaWindowKey(USER_A, WINDOW_HOURS, t2),
    );
  });

  it('same userId + crossing the window boundary → different key (window reset)', () => {
    const beforeBoundary = new Date('2026-03-03T23:59:59.999Z').getTime();
    const afterBoundary  = new Date('2026-03-04T00:00:00.001Z').getTime();
    expect(getQuotaWindowKey(USER_A, WINDOW_HOURS, beforeBoundary)).not.toBe(
      getQuotaWindowKey(USER_A, WINDOW_HOURS, afterBoundary),
    );
  });

  it('different userId + same timestamp → different key (cross-user isolation)', () => {
    expect(getQuotaWindowKey(USER_A, WINDOW_HOURS, NOW)).not.toBe(
      getQuotaWindowKey(USER_B, WINDOW_HOURS, NOW),
    );
  });

  it('key contains the userId substring (key is user-scoped)', () => {
    const k = getQuotaWindowKey(USER_A, WINDOW_HOURS, NOW);
    expect(k).toContain(USER_A);
  });

  it('key starts with expected prefix', () => {
    const k = getQuotaWindowKey(USER_A, WINDOW_HOURS, NOW);
    expect(k.startsWith('quota:match:decisions:')).toBe(true);
  });

  it('1-hour window: consecutive hours produce different keys', () => {
    const hour1 = new Date('2026-03-03T14:30:00Z').getTime();
    const hour2 = new Date('2026-03-03T15:01:00Z').getTime();
    expect(getQuotaWindowKey(USER_A, 1, hour1)).not.toBe(
      getQuotaWindowKey(USER_A, 1, hour2),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B) Redis path
// ─────────────────────────────────────────────────────────────────────────────

describe('checkDecisionsQuota — Redis path', () => {
  beforeEach(() => {
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '100';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '24';
  });

  afterEach(() => {
    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    jest.clearAllMocks();
  });

  it('Redis eval returns new count (5) → resolves without throwing', async () => {
    mockRedisClient(makeRedisWithEval(5));
    const tx = makeMockTx(0);
    await expect(checkDecisionsQuota(tx, USER_A, 5)).resolves.toBeUndefined();
    // DB count must NOT have been called — Redis path was used
    expect((tx as any).matchDecision.count).not.toHaveBeenCalled();
  });

  it('Redis eval returns -1 → throws QUOTA_EXCEEDED without touching DB', async () => {
    mockRedisClient(makeRedisWithEval(-1));
    const tx = makeMockTx(0); // DB fallback would say "ok", but Redis wins
    await expect(checkDecisionsQuota(tx, USER_A, 101)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect((tx as any).matchDecision.count).not.toHaveBeenCalled();
  });

  it('Redis eval returns non-numeric string → falls back to DB (quota ok)', async () => {
    mockRedisClient(makeRedisWithEval('VALID')); // test-mock default
    const tx = makeMockTx(10); // DB: 10 existing + 5 new = 15 ≤ 100
    await expect(checkDecisionsQuota(tx, USER_A, 5)).resolves.toBeUndefined();
    expect((tx as any).matchDecision.count).toHaveBeenCalledTimes(1);
  });

  it('Redis eval returns non-numeric string → falls back to DB (quota exceeded)', async () => {
    mockRedisClient(makeRedisWithEval('VALID'));
    const tx = makeMockTx(99); // DB: 99 existing + 5 new = 104 > 100
    await expect(checkDecisionsQuota(tx, USER_A, 5)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect((tx as any).matchDecision.count).toHaveBeenCalledTimes(1);
  });

  it('Redis eval throws (network error) → falls back to DB (quota ok)', async () => {
    mockRedisClient(makeRedisWithEvalError());
    const tx = makeMockTx(0);
    await expect(checkDecisionsQuota(tx, USER_A, 10)).resolves.toBeUndefined();
    expect((tx as any).matchDecision.count).toHaveBeenCalledTimes(1);
  });

  it('Redis eval throws → falls back to DB (quota exceeded)', async () => {
    mockRedisClient(makeRedisWithEvalError());
    const tx = makeMockTx(98); // 98 + 5 = 103 > 100
    await expect(checkDecisionsQuota(tx, USER_A, 5)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C) DB fallback path (Redis unavailable)
// ─────────────────────────────────────────────────────────────────────────────

describe('checkDecisionsQuota — DB fallback (Redis null)', () => {
  beforeEach(() => {
    mockRedisNull();
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '100';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '24';
  });

  afterEach(() => {
    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
  });

  it('DB: 0 existing + 5 new ≤ 100 → resolves', async () => {
    await expect(checkDecisionsQuota(makeMockTx(0), USER_A, 5)).resolves.toBeUndefined();
  });

  it('DB: 99 existing + 2 new = 101 > 100 → QUOTA_EXCEEDED', async () => {
    await expect(checkDecisionsQuota(makeMockTx(99), USER_A, 2)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
  });

  it('DB: exactly at limit (100 existing + 1 new = 101) → QUOTA_EXCEEDED', async () => {
    await expect(checkDecisionsQuota(makeMockTx(100), USER_A, 1)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
  });

  it('DB: exactly at limit (99 existing + 1 new = 100) → resolves (boundary)', async () => {
    await expect(checkDecisionsQuota(makeMockTx(99), USER_A, 1)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D) Window reset: key differs across window boundary → fresh quota
// ─────────────────────────────────────────────────────────────────────────────

describe('checkDecisionsQuota — window reset proof', () => {
  afterEach(() => {
    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    jest.clearAllMocks();
  });

  it('key for current window ≠ key for next window → Redis sees them as independent', () => {
    const windowHours = 24;
    const now   = new Date('2026-03-03T23:59:59Z').getTime();
    const later = new Date('2026-03-04T00:00:01Z').getTime();

    const keyNow   = getQuotaWindowKey(USER_A, windowHours, now);
    const keyLater = getQuotaWindowKey(USER_A, windowHours, later);

    // Different keys → Redis INCR operates on independent counters.
    // If the window key changes, the old counter has no effect on the new one.
    expect(keyNow).not.toBe(keyLater);

    // Structural proof: both are valid quota keys, just for different windows.
    expect(keyNow.startsWith('quota:match:decisions:')).toBe(true);
    expect(keyLater.startsWith('quota:match:decisions:')).toBe(true);
  });

  it('Redis: second window eval receives a fresh key (no carry-over)', async () => {
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '5';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '1';

    // Simulate quota full in window 1: eval returns -1 (exceeded)
    const redisFull = makeRedisWithEval(-1);
    mockRedisClient(redisFull);
    const tx1 = makeMockTx(0);
    await expect(checkDecisionsQuota(tx1, USER_A, 3)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });

    // Simulate window 2: eval returns 3 (fresh counter, within limit)
    const redisOk = makeRedisWithEval(3);
    mockRedisClient(redisOk);
    const tx2 = makeMockTx(0);
    await expect(checkDecisionsQuota(tx2, USER_A, 3)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E) Cross-user isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('checkDecisionsQuota — cross-user isolation', () => {
  beforeEach(() => {
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '10';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '24';
  });

  afterEach(() => {
    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    jest.clearAllMocks();
  });

  it('userA quota exceeded does NOT affect userB (Redis path)', async () => {
    // userA: Redis returns -1 (exceeded)
    const redisA = makeRedisWithEval(-1);
    mockRedisClient(redisA);
    await expect(checkDecisionsQuota(makeMockTx(0), USER_A, 11)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });

    // userB: Redis returns 5 (ok) — completely independent counter
    const redisB = makeRedisWithEval(5);
    mockRedisClient(redisB);
    await expect(checkDecisionsQuota(makeMockTx(0), USER_B, 5)).resolves.toBeUndefined();
  });

  it('userA quota exceeded does NOT affect userB (DB path)', async () => {
    mockRedisNull();

    // userA: 10 existing + 1 new = 11 > 10
    await expect(checkDecisionsQuota(makeMockTx(10), USER_A, 1)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });

    // userB: 0 existing + 5 new = 5 ≤ 10
    await expect(checkDecisionsQuota(makeMockTx(0), USER_B, 5)).resolves.toBeUndefined();
  });

  it('Redis eval is called with user-scoped key (not shared between users)', async () => {
    const redis = { eval: jest.fn().mockResolvedValue(1) };
    mockRedisClient(redis);

    await checkDecisionsQuota(makeMockTx(0), USER_A, 1);
    await checkDecisionsQuota(makeMockTx(0), USER_B, 1);

    const [callA, callB] = redis.eval.mock.calls;
    const keyA = (callA[1] as { keys: string[] }).keys[0];
    const keyB = (callB[1] as { keys: string[] }).keys[0];

    expect(keyA).toContain(USER_A);
    expect(keyB).toContain(USER_B);
    expect(keyA).not.toBe(keyB); // Separate Redis keys → no cross-user bleed
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F) Feature flag (env vars absent → fail-open)
// ─────────────────────────────────────────────────────────────────────────────

describe('checkDecisionsQuota — feature flag (env vars)', () => {
  afterEach(() => {
    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
  });

  it('both env vars absent → always resolves (quota disabled)', async () => {
    mockRedisNull();
    await expect(checkDecisionsQuota(makeMockTx(9999), USER_A, 9999)).resolves.toBeUndefined();
  });

  it('only MAX absent → resolves (partial config = disabled)', async () => {
    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '24';
    mockRedisNull();
    await expect(checkDecisionsQuota(makeMockTx(9999), USER_A, 9999)).resolves.toBeUndefined();
  });

  it('only WINDOW absent → resolves (partial config = disabled)', async () => {
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '10';
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    mockRedisNull();
    await expect(checkDecisionsQuota(makeMockTx(9999), USER_A, 9999)).resolves.toBeUndefined();
  });

  it('malformed MAX (non-integer) → resolves (fail-open)', async () => {
    process.env.MATCHING_DECISIONS_QUOTA_MAX = 'not-a-number';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '24';
    mockRedisNull();
    await expect(checkDecisionsQuota(makeMockTx(9999), USER_A, 9999)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G) Sliding window: getQuotaWindowKeys structure + boundary weights
// ─────────────────────────────────────────────────────────────────────────────

describe('getQuotaWindowKeys — sliding window structure', () => {
  const PERIOD_MS = 3_600_000; // 1-hour window

  it('currentKey matches getQuotaWindowKey for the same nowMs', () => {
    const nowMs = new Date('2026-03-03T14:30:00Z').getTime();
    const { currentKey } = getQuotaWindowKeys(USER_A, 1, nowMs);
    expect(currentKey).toBe(getQuotaWindowKey(USER_A, 1, nowMs));
  });

  it('prevKey is the key for the previous window (one period back)', () => {
    const nowMs = new Date('2026-03-03T14:30:00Z').getTime();
    const { prevKey } = getQuotaWindowKeys(USER_A, 1, nowMs);
    const prevPeriodAnyMs = nowMs - PERIOD_MS; // any timestamp in the previous window
    expect(prevKey).toBe(getQuotaWindowKey(USER_A, 1, prevPeriodAnyMs));
  });

  it('currentKey ≠ prevKey (different windows)', () => {
    const nowMs = new Date('2026-03-03T14:30:00Z').getTime();
    const { currentKey, prevKey } = getQuotaWindowKeys(USER_A, 1, nowMs);
    expect(currentKey).not.toBe(prevKey);
  });

  it('elapsedMs is in [0, periodMs)', () => {
    const nowMs = new Date('2026-03-03T14:30:00Z').getTime();
    const { elapsedMs, periodMs } = getQuotaWindowKeys(USER_A, 1, nowMs);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
    expect(elapsedMs).toBeLessThan(periodMs);
  });

  it('at window start (elapsed ≈ 0): prevWeight ≈ 1 (previous counts fully)', () => {
    // Position: 1ms after window start → elapsed = 1ms
    const windowStart = Math.floor(new Date('2026-03-03T15:00:00Z').getTime() / PERIOD_MS) * PERIOD_MS;
    const nowMs = windowStart + 1;
    const { elapsedMs, periodMs } = getQuotaWindowKeys(USER_A, 1, nowMs);
    const prevWeight = 1 - elapsedMs / periodMs;
    // 1 - 1/3600000 ≈ 0.9999997 → effectively 1
    expect(prevWeight).toBeGreaterThan(0.999);
    expect(prevWeight).toBeLessThanOrEqual(1);
  });

  it('at window midpoint (elapsed = 50%): prevWeight = 0.5', () => {
    const windowStart = Math.floor(new Date('2026-03-03T15:00:00Z').getTime() / PERIOD_MS) * PERIOD_MS;
    const nowMs = windowStart + PERIOD_MS / 2;
    const { elapsedMs, periodMs } = getQuotaWindowKeys(USER_A, 1, nowMs);
    const prevWeight = 1 - elapsedMs / periodMs;
    expect(prevWeight).toBeCloseTo(0.5, 5);
  });

  it('near end of window (elapsed ≈ 99.99%): prevWeight ≈ 0 (previous barely counts)', () => {
    const windowStart = Math.floor(new Date('2026-03-03T15:00:00Z').getTime() / PERIOD_MS) * PERIOD_MS;
    const nowMs = windowStart + PERIOD_MS - 1; // 1ms before end
    const { elapsedMs, periodMs } = getQuotaWindowKeys(USER_A, 1, nowMs);
    const prevWeight = 1 - elapsedMs / periodMs;
    expect(prevWeight).toBeGreaterThanOrEqual(0);
    expect(prevWeight).toBeLessThan(0.001);
  });

  it('sliding window Lua is called with 2 keys (current + prev)', async () => {
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '10';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '1';

    const nowMs = new Date('2026-03-03T14:30:00Z').getTime();
    const redis = { eval: jest.fn().mockResolvedValue(3) };
    mockRedisClient(redis);

    await checkDecisionsQuota(makeMockTx(0), USER_A, 3, nowMs);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    const opts = redis.eval.mock.calls[0][1] as { keys: string[]; arguments: string[] };
    // Sliding window uses 2 keys: current bucket + previous bucket
    expect(opts.keys).toHaveLength(2);
    expect(opts.keys[0]).toContain(USER_A); // current key
    expect(opts.keys[1]).toContain(USER_A); // prev key
    expect(opts.keys[0]).not.toBe(opts.keys[1]); // different windows

    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    jest.clearAllMocks();
  });

  it('double-dip scenario: at boundary previous=max → Lua -1 → QUOTA_EXCEEDED', async () => {
    // Simulates: user hit max in previous window; 1ms into new window.
    // Sliding weight ≈ 1 → effective = 0 + max = max → adding any positive delta exceeds.
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '10';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '1';

    const redis = { eval: jest.fn().mockResolvedValue(-1) }; // Lua: exceeded
    mockRedisClient(redis);

    await expect(checkDecisionsQuota(makeMockTx(0), USER_A, 1)).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });

    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    jest.clearAllMocks();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H) refundDecisionsQuota — DECRBY best-effort
// ─────────────────────────────────────────────────────────────────────────────

describe('refundDecisionsQuota — DECRBY best-effort', () => {
  beforeEach(() => {
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '10';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '1';
  });

  afterEach(() => {
    delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    jest.clearAllMocks();
  });

  it('Redis available → calls eval (REFUND_LUA) exactly once with correct key + delta', async () => {
    const nowMs = new Date('2026-03-03T14:30:00Z').getTime();
    const redis = { eval: jest.fn().mockResolvedValue(7) };
    mockRedisClient(redis);

    await refundDecisionsQuota(USER_A, 3, nowMs);

    expect(redis.eval).toHaveBeenCalledTimes(1);
    const opts = redis.eval.mock.calls[0][1] as { keys: string[]; arguments: string[] };
    expect(opts.keys).toHaveLength(1);
    expect(opts.keys[0]).toContain(USER_A); // user-scoped key
    expect(opts.arguments[0]).toBe('3');    // delta = 3 (correct count)
  });

  it('refund key matches the same window as checkDecisionsQuota would use', async () => {
    const nowMs = new Date('2026-03-03T14:30:00Z').getTime();
    const redis = { eval: jest.fn().mockResolvedValue(5) };
    mockRedisClient(redis);

    // Charge then refund at the same nowMs
    await checkDecisionsQuota(makeMockTx(0), USER_A, 5, nowMs);
    await refundDecisionsQuota(USER_A, 5, nowMs);

    expect(redis.eval).toHaveBeenCalledTimes(2);
    const chargeKey = (redis.eval.mock.calls[0][1] as { keys: string[] }).keys[0];
    const refundKey = (redis.eval.mock.calls[1][1] as { keys: string[] }).keys[0];
    // Both should target the same current bucket
    expect(refundKey).toBe(chargeKey);
  });

  it('Redis unavailable → no-op, no throw', async () => {
    mockRedisNull();
    await expect(refundDecisionsQuota(USER_A, 5)).resolves.toBeUndefined();
  });

  it('Redis eval throws → swallowed (best-effort, does NOT throw)', async () => {
    const redis = { eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
    mockRedisClient(redis);
    await expect(refundDecisionsQuota(USER_A, 5)).resolves.toBeUndefined();
  });

  it('feature disabled (WINDOW_HOURS absent) → no-op, Redis not called', async () => {
    delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    const redis = { eval: jest.fn() };
    mockRedisClient(redis);
    await refundDecisionsQuota(USER_A, 5);
    expect(redis.eval).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I) isServerError — error classification for refund decision
// ─────────────────────────────────────────────────────────────────────────────

describe('isServerError — classifies 4xx vs 5xx', () => {
  // ZodError → 4xx validation
  it('ZodError → false (client error)', () => {
    const zodErr = new Error('validation');
    zodErr.name = 'ZodError';
    expect(isServerError(zodErr)).toBe(false);
  });

  // QUOTA_EXCEEDED → 4xx business rule
  it('QUOTA_EXCEEDED code → false (client error)', () => {
    const err = Object.assign(new Error('Quota exceeded'), { code: 'QUOTA_EXCEEDED' });
    expect(isServerError(err)).toBe(false);
  });

  // Prisma P2xxx → 4xx constraint / not-found
  it('Prisma P2025 (not found) → false (client error)', () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' });
    expect(isServerError(err)).toBe(false);
  });

  it('Prisma P2002 (unique constraint) → false (client error)', () => {
    const err = Object.assign(new Error('Unique violation'), { code: 'P2002' });
    expect(isServerError(err)).toBe(false);
  });

  // Prisma P1xxx → 5xx infrastructure
  it('Prisma P1001 (unreachable DB) → true (server error)', () => {
    const err = Object.assign(new Error('DB unreachable'), { code: 'P1001' });
    expect(isServerError(err)).toBe(true);
  });

  it('Prisma P1017 (connection reset) → true (server error)', () => {
    const err = Object.assign(new Error('Connection reset'), { code: 'P1017' });
    expect(isServerError(err)).toBe(true);
  });

  // HttpException-like with explicit status
  it('HttpException status=400 → false (client error)', () => {
    const err = Object.assign(new Error('Bad request'), { status: 400 });
    expect(isServerError(err)).toBe(false);
  });

  it('HttpException status=403 → false (client error)', () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(isServerError(err)).toBe(false);
  });

  it('HttpException status=500 → true (server error)', () => {
    const err = Object.assign(new Error('Internal'), { status: 500 });
    expect(isServerError(err)).toBe(true);
  });

  it('HttpException status=503 → true (server error)', () => {
    const err = Object.assign(new Error('Service unavailable'), { status: 503 });
    expect(isServerError(err)).toBe(true);
  });

  // Unknown error → safe default = server error
  it('plain Error (no code, no status) → true (unknown → safe default)', () => {
    expect(isServerError(new Error('unexpected'))).toBe(true);
  });

  it('null → true (safe default)', () => {
    expect(isServerError(null)).toBe(true);
  });

  it('string → true (safe default)', () => {
    expect(isServerError('some error string')).toBe(true);
  });

  // Proof: QUOTA_EXCEEDED not refunded, but P1001 is refunded
  it('4xx errors (ZodError, QUOTA_EXCEEDED, P2xxx) never trigger refund — all false', () => {
    const cases = [
      Object.assign(new Error(), { name: 'ZodError' }),
      Object.assign(new Error(), { code: 'QUOTA_EXCEEDED' }),
      Object.assign(new Error(), { code: 'P2025' }),
      Object.assign(new Error(), { code: 'P2002' }),
      Object.assign(new Error(), { status: 400 }),
      Object.assign(new Error(), { status: 429 }),
    ];
    for (const err of cases) {
      expect(isServerError(err)).toBe(false);
    }
  });

  it('5xx errors (P1xxx, status>=500, unknown) always trigger refund — all true', () => {
    const cases = [
      Object.assign(new Error(), { code: 'P1001' }),
      Object.assign(new Error(), { code: 'P1017' }),
      Object.assign(new Error(), { status: 500 }),
      Object.assign(new Error(), { status: 503 }),
      new Error('unexpected server fault'),
    ];
    for (const err of cases) {
      expect(isServerError(err)).toBe(true);
    }
  });
});
