import { secureLogger } from '../utils/secure-logger';

const BURST_POINTS_PER_SEC = Number(process.env.WS_BURST_POINTS_PER_SEC || '10');
const BURST_CAPACITY = Number(process.env.WS_BURST_CAPACITY || '20');
const BURST_STRICT_POINTS_PER_SEC = Number(process.env.WS_BURST_STRICT_POINTS_PER_SEC || '4');
const BURST_STRICT_CAPACITY = Number(process.env.WS_BURST_STRICT_CAPACITY || '8');
const BURST_BLOCK_MS = Number(process.env.WS_BURST_BLOCK_MS || '1000');

type BucketState = {
  tokens: number;
  lastRefillMs: number;
  blockedUntilMs: number;
  lastSeenMs: number;
};

type BurstMetrics = {
  allowed: number;
  blocked: number;
  strictBlocked: number;
  entries: number;
};

const buckets = new Map<string, BucketState>();
const metrics: BurstMetrics = {
  allowed: 0,
  blocked: 0,
  strictBlocked: 0,
  entries: 0
};

function cleanupBuckets(now: number): void {
  if (buckets.size < 512) {
    metrics.entries = buckets.size;
    return;
  }

  for (const [key, state] of buckets.entries()) {
    if (state.lastSeenMs + 120000 <= now) {
      buckets.delete(key);
    }
  }

  metrics.entries = buckets.size;
}

export function checkBurstLimit(
  key: string,
  opts?: { strict?: boolean; cost?: number }
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const strict = opts?.strict === true;
  const cost = opts?.cost ?? 1;
  const now = Date.now();
  cleanupBuckets(now);

  const rate = strict ? BURST_STRICT_POINTS_PER_SEC : BURST_POINTS_PER_SEC;
  const capacity = strict ? BURST_STRICT_CAPACITY : BURST_CAPACITY;

  const state = buckets.get(key) || {
    tokens: capacity,
    lastRefillMs: now,
    blockedUntilMs: 0,
    lastSeenMs: now
  };

  state.lastSeenMs = now;

  if (state.blockedUntilMs > now) {
    const retryAfterMs = state.blockedUntilMs - now;
    metrics.blocked += 1;
    if (strict) metrics.strictBlocked += 1;
    buckets.set(key, state);
    return { allowed: false, retryAfterMs };
  }

  const elapsedSec = Math.max(0, (now - state.lastRefillMs) / 1000);
  state.tokens = Math.min(capacity, state.tokens + elapsedSec * rate);
  state.lastRefillMs = now;

  if (state.tokens < cost) {
    state.blockedUntilMs = now + BURST_BLOCK_MS;
    buckets.set(key, state);
    metrics.blocked += 1;
    if (strict) metrics.strictBlocked += 1;
    secureLogger.debug('WS_BURST_LIMIT_BLOCKED', {
      strict,
      retryAfterMs: BURST_BLOCK_MS
    });
    return { allowed: false, retryAfterMs: BURST_BLOCK_MS };
  }

  state.tokens -= cost;
  buckets.set(key, state);
  metrics.allowed += 1;
  metrics.entries = buckets.size;
  return { allowed: true };
}

export function getBurstMetrics(): BurstMetrics & {
  pointsPerSec: number;
  capacity: number;
  strictPointsPerSec: number;
  strictCapacity: number;
  blockMs: number;
} {
  return {
    ...metrics,
    pointsPerSec: BURST_POINTS_PER_SEC,
    capacity: BURST_CAPACITY,
    strictPointsPerSec: BURST_STRICT_POINTS_PER_SEC,
    strictCapacity: BURST_STRICT_CAPACITY,
    blockMs: BURST_BLOCK_MS
  };
}

export function resetBurstMetricsForTests(): void {
  buckets.clear();
  metrics.allowed = 0;
  metrics.blocked = 0;
  metrics.strictBlocked = 0;
  metrics.entries = 0;
}
