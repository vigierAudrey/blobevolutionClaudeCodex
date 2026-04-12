/**
 * Tests de non-régression pour POST /auth/2fa/send
 *
 * Menaces couvertes :
 * 1. User enumeration via réponse différentielle (compte inexistant vs PRO existant)
 * 2. User enumeration via tooManyChallenges → doit retourner le même 200 générique
 * 3. Rate limit par email (3 req/10min) → 4ème requête → 429
 * 4. Compte RIDER (non-PRO) → même réponse générique que compte inexistant
 */

jest.mock('../../../lib/mailer', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  send2FACode: jest.fn().mockResolvedValue({ sent: true }),
}));

// Cache service mock en mémoire — simule Redis absent (fallback mémoire pour 2FA)
jest.mock('../../../services/cache.service', () => {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    cacheService: {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn(() => null),
      get: jest.fn(async (key: string) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
          store.delete(key);
          return null;
        }
        return entry.value;
      }),
      set: jest.fn(async (key: string, value: unknown, ttlSeconds: number = 300) => {
        store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return true;
      }),
      del: jest.fn(async (key: string) => {
        store.delete(key);
        return true;
      }),
      // Typed 2FA hash methods — client_unavailable triggers memory fallback in two-factor.service
      setTwoFactorCodeHash: jest.fn(async () => ({ ok: false, reason: 'client_unavailable' })),
      getTwoFactorCodeHash: jest.fn(async () => ({ ok: false, reason: 'client_unavailable' })),
      initialize: jest.fn(async () => undefined),
      __reset: () => store.clear(),
    },
  };
});

import bcrypt from 'bcryptjs';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { resetDb } from '../../../test-utils/resetDb';
import { createTestSession } from '../../../tests/helpers/auth';
import { challengeCounter } from '../../../services/two-factor.service';
import { send2FACode } from '../../../lib/mailer';

const mockSend2FACode = send2FACode as jest.MockedFunction<typeof send2FACode>;

const GENERIC_MESSAGE = 'Si un compte PRO correspondant existe, un code a été envoyé.';

const app = createApp();

describe('POST /auth/2fa/send — anti-énumération et rate limit', () => {
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

  beforeEach(async () => {
    await resetDb();
    // Réinitialiser le compteur de challenges en mémoire entre les tests
    challengeCounter.clear();
  });

  it('retourne 200 avec message générique pour un email inexistant', async () => {
    const session = await createTestSession(app);
    const res = await session
      .post('/auth/2fa/send')
      .send({ email: 'no-such-user-2fa@test.com' })
      .expect(200);

    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(res.body.error).toBeUndefined();
  });

  it('retourne 200 avec message générique pour un compte RIDER (non-PRO)', async () => {
    const session = await createTestSession(app);
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    await prisma.user.create({
      data: {
        email: 'rider-2fa@test.com',
        password: hashed,
        role: Role.RIDER,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });

    const res = await session
      .post('/auth/2fa/send')
      .send({ email: 'rider-2fa@test.com' })
      .expect(200);

    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(res.body.error).toBeUndefined();
  });

  it('retourne 200 avec message générique pour un compte PRO valide', async () => {
    const session = await createTestSession(app);
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    await prisma.user.create({
      data: {
        email: 'pro-2fa-ok@test.com',
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });

    const res = await session
      .post('/auth/2fa/send')
      .send({ email: 'pro-2fa-ok@test.com' })
      .expect(200);

    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(res.body.error).toBeUndefined();
  });

  it('retourne 200 générique (pas 429) quand tooManyChallenges pour un PRO — anti-énumération', async () => {
    // Scénario : un attaquant sature les challenges actifs (max = TWO_FACTOR_MAX_CONCURRENT_CHALLENGES)
    // puis envoie une nouvelle requête. Sans le correctif, le code retournait 429 { error: ... }
    // ce qui permettait de distinguer un compte PRO existant d'un compte inexistant.
    const session = await createTestSession(app);
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    const user = await prisma.user.create({
      data: {
        email: 'pro-2fa-flood@test.com',
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });

    // Envoyer un code réel pour qu'il y ait un code actif en cache (sans ça, le stale-reset
    // efface le compteur avant le check — le tooManyChallenges ne se déclenche jamais).
    await session.post('/auth/2fa/send').send({ email: 'pro-2fa-flood@test.com' }).expect(200);
    expect(challengeCounter.get(user.id)).toBe(1);

    // Forcer le compteur au maximum avec un code actif en cache
    const maxChallenges = parseInt(process.env.TWO_FACTOR_MAX_CONCURRENT_CHALLENGES ?? '3', 10);
    challengeCounter.set(user.id, maxChallenges);

    // La prochaine requête /2fa/send doit retourner 200 générique (pas 429)
    const res = await session
      .post('/auth/2fa/send')
      .send({ email: 'pro-2fa-flood@test.com' })
      .expect(200);

    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(res.body.error).toBeUndefined();
    // Surtout pas de status 429 → sinon enumeration
  });

  it('stale counter reset — code expiré sans verify/cancel ne bloque pas le prochain send', async () => {
    // Bug P1 : challengeCounter n'était jamais décrémenté si le code expirait naturellement (TTL Redis).
    // Après MAX challenges expirés, l'utilisateur était définitivement bloqué sur ce pod.
    const session = await createTestSession(app);
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    const user = await prisma.user.create({
      data: {
        email: 'pro-2fa-stale@test.com',
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });

    // Simuler : MAX challenges envoyés et le code a expiré (plus rien en cache)
    // Le compteur est à MAX mais aucun code actif → stale
    const maxChallenges = parseInt(process.env.TWO_FACTOR_MAX_CONCURRENT_CHALLENGES ?? '3', 10);
    challengeCounter.set(user.id, maxChallenges);
    // Aucun code planté en mock cache pour cet userId → cacheService.get() retourne null

    // Le prochain send doit détecter le stale counter, le reset, et envoyer un code
    const res = await session
      .post('/auth/2fa/send')
      .send({ email: 'pro-2fa-stale@test.com' })
      .expect(200);

    expect(res.body.message).toBe(GENERIC_MESSAGE);
    // Compteur doit être à 1 (reset + increment du nouveau code)
    expect(challengeCounter.get(user.id)).toBe(1);
  });

  it('déclenche le rate limit après 3 tentatives sur le même email (429)', async () => {
    const session = await createTestSession(app);
    const email = 'pro-2fa-ratelimit@test.com';
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    await prisma.user.create({
      data: {
        email,
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });

    // 3 requêtes autorisées
    for (let i = 0; i < 3; i += 1) {
      await session.post('/auth/2fa/send').send({ email }).expect(200);
    }

    // 4ème requête → rate limit
    const res = await session.post('/auth/2fa/send').send({ email }).expect(429);
    expect(res.body.error).toBe('TOO_MANY_2FA_REQUESTS');
  });

  it('challengeCounter décrémenté après verify réussie — re-envoi possible immédiatement', async () => {
    // Preuve que verifyCode décrémente le compteur, sinon un user qui vérifie MAX fois
    // est définitivement bloqué jusqu'au redémarrage du serveur.
    const session = await createTestSession(app);
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    const user = await prisma.user.create({
      data: {
        email: 'pro-2fa-decrement@test.com',
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });

    // Send → counter = 1
    await session.post('/auth/2fa/send').send({ email: 'pro-2fa-decrement@test.com' }).expect(200);
    expect(challengeCounter.get(user.id)).toBe(1);

    // Verify avec code réel → counter décrémenté à 0
    const lastCall = mockSend2FACode.mock.calls.at(-1);
    const sentCode = lastCall?.[1];
    if (!sentCode || typeof sentCode !== 'string') throw new Error('No 2FA code captured');

    await session.post('/auth/2fa/verify').send({ email: 'pro-2fa-decrement@test.com', code: sentCode }).expect(200);
    expect(challengeCounter.get(user.id) ?? 0).toBe(0);

    // Re-envoi immédiat sans blocage
    const resResend = await session.post('/auth/2fa/send').send({ email: 'pro-2fa-decrement@test.com' }).expect(200);
    expect(resResend.body.message).toBe(GENERIC_MESSAGE);
  });

  it('le rate limit /2fa/send est par email, pas par IP — comptes différents non impactés', async () => {
    const session = await createTestSession(app);
    const hashed = await bcrypt.hash('Passw0rd!', 12);

    const emailA = 'pro-2fa-rl-a@test.com';
    const emailB = 'pro-2fa-rl-b@test.com';

    for (const email of [emailA, emailB]) {
      await prisma.user.create({
        data: {
          email,
          password: hashed,
          role: Role.PRO,
          emailVerified: true,
          consentedAt: new Date(),
          consentVersion: 'v1.0.0',
        },
      });
    }

    // Épuiser le budget de emailA (3 requêtes)
    for (let i = 0; i < 3; i += 1) {
      await session.post('/auth/2fa/send').send({ email: emailA }).expect(200);
    }
    // emailA est maintenant rate-limited
    await session.post('/auth/2fa/send').send({ email: emailA }).expect(429);

    // emailB reste libre — budget indépendant par email
    const res = await session.post('/auth/2fa/send').send({ email: emailB }).expect(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
  });
});
