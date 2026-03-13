import { secureLogger } from '../utils/secure-logger';

const PREAUTH_RL_ENABLED = process.env.WS_PREAUTH_RL_ENABLED !== 'false';
const PREAUTH_RL_POINTS = Number(process.env.WS_PREAUTH_RL_POINTS || '30');
const PREAUTH_RL_WINDOW_MS = Number(process.env.WS_PREAUTH_RL_WINDOW_MS || '10000');
const PREAUTH_RL_BASE_BAN_MS = Number(process.env.WS_PREAUTH_RL_BASE_BAN_MS || '60000');
const PREAUTH_RL_MAX_BAN_MS = Number(process.env.WS_PREAUTH_RL_MAX_BAN_MS || String(10 * 60 * 1000));

const PREAUTH_RL_CLEANUP_MS = Math.max(PREAUTH_RL_WINDOW_MS, PREAUTH_RL_BASE_BAN_MS) * 2;

interface PreAuthIpState {
  windowStartMs: number;
  count: number;
  strikes: number;
  banUntilMs: number;
  lastSeenMs: number;
}

interface PreAuthRateLimitMetrics {
  allowed: number;
  blocked: number;
  banned: number;
  entries: number;
}

const ipStates = new Map<string, PreAuthIpState>();

const metrics: PreAuthRateLimitMetrics = {
  allowed: 0,
  blocked: 0,
  banned: 0,
  entries: 0
};

function nowMs(): number {
  return Date.now();
}

function cleanupExpiredStates(now: number): void {
  if (ipStates.size < 512) {
    metrics.entries = ipStates.size;
    return;
  }

  for (const [ip, state] of ipStates.entries()) {
    if (state.lastSeenMs + PREAUTH_RL_CLEANUP_MS <= now) {
      ipStates.delete(ip);
    }
  }

  metrics.entries = ipStates.size;
}

function computeBanMs(strikes: number): number {
  const power = Math.max(0, strikes - 1);
  const duration = PREAUTH_RL_BASE_BAN_MS * Math.pow(2, power);
  return Math.min(duration, PREAUTH_RL_MAX_BAN_MS);
}

export type PreAuthRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; reason: 'MISSING_IP' | 'RATE_LIMITED' };

export function checkPreAuthIpRateLimit(ip: string | undefined): PreAuthRateLimitResult {
  if (!PREAUTH_RL_ENABLED) {
    return { allowed: true };
  }

  if (!ip) {
    metrics.blocked += 1;
    return { allowed: false, retryAfterMs: PREAUTH_RL_BASE_BAN_MS, reason: 'MISSING_IP' };
  }

  const now = nowMs();
  cleanupExpiredStates(now);

  const existing = ipStates.get(ip);
  const state: PreAuthIpState = existing || {
    windowStartMs: now,
    count: 0,
    strikes: 0,
    banUntilMs: 0,
    lastSeenMs: now
  };

  state.lastSeenMs = now;

  if (state.banUntilMs > now) {
    const retryAfterMs = state.banUntilMs - now;
    metrics.blocked += 1;
    metrics.entries = ipStates.size;
    ipStates.set(ip, state);
    return { allowed: false, retryAfterMs, reason: 'RATE_LIMITED' };
  }

  if (now - state.windowStartMs >= PREAUTH_RL_WINDOW_MS) {
    state.windowStartMs = now;
    state.count = 0;
  }

  state.count += 1;
  if (state.count > PREAUTH_RL_POINTS) {
    state.strikes += 1;
    const banMs = computeBanMs(state.strikes);
    state.banUntilMs = now + banMs;
    state.windowStartMs = now;
    state.count = 0;
    ipStates.set(ip, state);

    metrics.blocked += 1;
    metrics.banned += 1;
    metrics.entries = ipStates.size;

    secureLogger.warn('WS_PREAUTH_RATE_LIMIT_BLOCKED', {
      ip: ip.length > 10 ? `${ip.slice(0, 10)}...` : ip,
      strikes: state.strikes,
      banMs
    });

    return { allowed: false, retryAfterMs: banMs, reason: 'RATE_LIMITED' };
  }

  ipStates.set(ip, state);
  metrics.allowed += 1;
  metrics.entries = ipStates.size;
  return { allowed: true };
}

export function getPreAuthRateLimitMetrics(): PreAuthRateLimitMetrics & {
  enabled: boolean;
  points: number;
  windowMs: number;
  baseBanMs: number;
  maxBanMs: number;
} {
  return {
    enabled: PREAUTH_RL_ENABLED,
    points: PREAUTH_RL_POINTS,
    windowMs: PREAUTH_RL_WINDOW_MS,
    baseBanMs: PREAUTH_RL_BASE_BAN_MS,
    maxBanMs: PREAUTH_RL_MAX_BAN_MS,
    ...metrics
  };
}

export function resetPreAuthRateLimitForTests(): void {
  ipStates.clear();
  metrics.allowed = 0;
  metrics.blocked = 0;
  metrics.banned = 0;
  metrics.entries = 0;
}
