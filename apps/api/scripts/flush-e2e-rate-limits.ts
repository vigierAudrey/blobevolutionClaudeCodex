/**
 * E2E test helper — flush auth rate-limit keys from Redis.
 *
 * Problem: express-rate-limit with Redis store persists `rl:auth_login*` counters
 * for 15 minutes (window TTL). When Playwright tests are run repeatedly in a short
 * window, these counters accumulate across server restarts and eventually trigger
 * AUTH_RATE_LIMIT_EXCEEDED (429) on the very first login of a new run.
 *
 * This script deletes only the `rl:auth_login*` keys — the three auth login limiters:
 *   - rl:auth_login_ip:*        (loginIpLimiter, 20/15min/IP)
 *   - rl:auth_login_account_ip:* (loginAccountIpLimiter, 5/15min/email+IP)
 *   - rl:auth_login_email:*     (loginEmailLimiter, 10/15min/email — already skips
 *                                in dev/test, included for completeness)
 *
 * SCOPE: E2E test setup ONLY. Never called in production.
 * IMPACT: counters reset to 0 — equivalent to the 15-min window expiring naturally.
 * NO PROD CHANGE: this file is a test script, it does not modify any prod code.
 */

import 'dotenv/config';
import { resolve } from 'path';

try {
  // Load .env from repo root
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  const ok = dotenv.config({ path: resolve(__dirname, '../../../.env') });
  if (!ok?.parsed) dotenv.config({ path: resolve(__dirname, '../.env') });
} catch {}

import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

async function flushAuthRateLimitKeys(): Promise<void> {
  const client = createClient({
    url: REDIS_URL,
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    socket: { connectTimeout: 5000 },
  });

  client.on('error', () => {}); // Silence — fail-open if Redis unavailable

  try {
    await client.connect();
    await client.ping();
  } catch {
    // Redis unreachable — no keys to flush, safe to skip
    console.log('[flush-e2e-rate-limits] Redis unreachable — skipping flush (fail-open)');
    try { await client.quit(); } catch {}
    return;
  }

  try {
    const patterns = [
      'rl:auth_login_ip:*',
      'rl:auth_login_account_ip:*',
      'rl:auth_login_email:*',
    ];

    let totalDeleted = 0;
    for (const pattern of patterns) {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
        totalDeleted += keys.length;
      }
    }

    if (totalDeleted > 0) {
      console.log(`[flush-e2e-rate-limits] Deleted ${totalDeleted} auth rate-limit key(s)`);
    } else {
      console.log('[flush-e2e-rate-limits] No auth rate-limit keys to flush');
    }
  } finally {
    await client.quit();
  }
}

flushAuthRateLimitKeys().catch((err) => {
  // Non-fatal — test suite will catch actual failures
  console.warn('[flush-e2e-rate-limits] Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(0); // exit 0: don't block the E2E run
});
