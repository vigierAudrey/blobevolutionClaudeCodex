/**
 * Proof that loginAccountIpLimiter.skipSuccessfulRequests is absent (false by default).
 *
 * This test lives in its own file so that Jest's module isolation gives it a fresh
 * MemoryStore — the shared-IP counter from active-user-login-rate-limit.e2e.test.ts
 * would otherwise exhaust loginIpLimiter (max=20) before this test can run.
 *
 * Security invariant being tested:
 *   An attacker who can authenticate (knows a valid password) CANNOT cycle between
 *   valid credentials indefinitely to keep their account+IP budget from ever depleting.
 *   After 5 successful logins, the 6th is blocked — same as 5 failed attempts would be.
 */

import { createApp } from '../../../index';
import { createTestSession, getOrCreateUserByEmail } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';
import { clientPrisma as prisma, Role } from '@blobinfini/database';

const app = createApp();

describe('loginAccountIpLimiter — skipSuccessfulRequests=false (default)', () => {
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

  it('successful logins consume the account+IP budget and trigger 429 on the 6th', async () => {
    // Preuve que loginAccountIpLimiter.skipSuccessfulRequests est absent (false par défaut).
    // Si skipSuccessfulRequests était true, les logins réussis ne consommeraient pas le budget
    // et l'attaquant pourrait interleaver des logins valides pour ne jamais être bloqué.
    //
    // Timestamp dans l'email pour éviter toute pollution depuis un autre test dans la même fenêtre.
    await resetDb();
    const session = await createTestSession(app);
    const email = `skip-sr-${Date.now()}@test.com`;

    await getOrCreateUserByEmail({
      email,
      role: Role.RIDER,
      emailVerified: true,
    });

    // loginAccountIpLimiter: max=5 per email+IP. 5 valid logins must all succeed.
    for (let i = 0; i < 5; i += 1) {
      await session
        .post('/auth/login')
        .send({ email, password: 'Passw0rd!', consentAccepted: true })
        .expect(200);
    }

    // 6th valid login → 429: budget exhausted even though all 5 previous were successful.
    // Proof that skipSuccessfulRequests is false.
    const blocked = await session
      .post('/auth/login')
      .send({ email, password: 'Passw0rd!', consentAccepted: true });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('AUTH_RATE_LIMIT_EXCEEDED');
  });
});
