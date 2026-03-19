/**
 * Tests covering login rate-limit behavior with real in-memory counters.
 *
 * All tests run within the same describe block and share the same Express app
 * instance (and therefore the same MemoryStore for loginIpLimiter / loginAccountIpLimiter).
 * Each test is designed so that the cumulative request count stays within the
 * loginIpLimiter cap (max=20 / 15min / IP):
 *
 *   Test 1: 5 requests  → total IP counter: 5
 *   Test 2: 9 requests  → total IP counter: 14
 *   Test 3: 6 requests  → total IP counter: 20  (exactly at limit — 20th passes)
 *
 * Test 4 (skipSuccessfulRequests=false proof) lives in its own file
 * (login-skip-sr.e2e.test.ts) to get a fresh module registry and a clean counter.
 */

import { createApp } from '../../../index';
import { createTestSession, getOrCreateUserByEmail } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';
import { clientPrisma as prisma, Role } from '@blobinfini/database';

const app = createApp();

describe('Active user login rate limit', () => {
  const previousRateLimitFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;

  beforeAll(() => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
  });

  afterAll(async () => {
    if (previousRateLimitFlag === undefined) {
      delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    } else {
      process.env.ENABLE_RATE_LIMIT_IN_TESTS = previousRateLimitFlag;
    }
    await prisma.$disconnect();
  });

  it('does not throttle up to 5 consecutive successful logins (loginAccountIpLimiter budget)', async () => {
    // loginAccountIpLimiter: max=5 per email+IP window.
    // 5 logins with the same credentials must all return 200.
    await resetDb();
    const session = await createTestSession(app);
    const email = 'abuse-login@test.com';

    await getOrCreateUserByEmail({
      email,
      role: Role.RIDER,
      emailVerified: true,
    });

    for (let i = 0; i < 5; i += 1) {
      await session
        .post('/auth/login')
        .send({ email, password: 'Passw0rd!', consentAccepted: true })
        .expect(200);
    }
  });

  it('does not penalize two legitimate accounts sharing the same test IP before the network cap', async () => {
    // loginAccountIpLimiter key = email+IP: two accounts have INDEPENDENT budgets.
    // loginIpLimiter key = IP only (max=20): this is the "network cap".
    // Each account does 4 logins in the interleaved loop, then one final login
    // for firstEmail (5th total for that email) — within the per-account budget.
    await resetDb();
    const firstSession = await createTestSession(app);
    const secondSession = await createTestSession(app);
    const firstEmail = 'abuse-login-a@test.com';
    const secondEmail = 'abuse-login-b@test.com';

    await getOrCreateUserByEmail({
      email: firstEmail,
      role: Role.RIDER,
      emailVerified: true,
    });
    await getOrCreateUserByEmail({
      email: secondEmail,
      role: Role.RIDER,
      emailVerified: true,
    });

    for (let i = 0; i < 4; i += 1) {
      await firstSession
        .post('/auth/login')
        .send({ email: firstEmail, password: 'Passw0rd!', consentAccepted: true })
        .expect(200);
      await secondSession
        .post('/auth/login')
        .send({ email: secondEmail, password: 'Passw0rd!', consentAccepted: true })
        .expect(200);
    }

    // secondEmail has 4 logins; firstEmail also has 4 — their budgets are independent.
    // This 5th login for firstEmail must succeed despite secondEmail's activity.
    await firstSession
      .post('/auth/login')
      .send({ email: firstEmail, password: 'Passw0rd!', consentAccepted: true })
      .expect(200);
  });

  it('rate limits repeated failed logins for the same account on the same network', async () => {
    await resetDb();
    const session = await createTestSession(app);
    const email = 'abuse-login-fail@test.com';

    await getOrCreateUserByEmail({
      email,
      role: Role.RIDER,
      emailVerified: true,
    });

    for (let i = 0; i < 5; i += 1) {
      await session
        .post('/auth/login')
        .send({ email, password: 'WrongPassw0rd!', consentAccepted: true })
        .expect(401);
    }

    await session
      .post('/auth/login')
      .send({ email, password: 'WrongPassw0rd!', consentAccepted: true })
      .expect(429)
      .expect((response) => {
        expect(response.body.error).toBe('AUTH_RATE_LIMIT_EXCEEDED');
      });
  });
});
