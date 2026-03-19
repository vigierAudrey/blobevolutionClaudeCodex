/**
 * Tests POST /auth/2fa/verify — anti-énumération (Option A).
 *
 * Menaces couvertes :
 * - Un attaquant qui envoie email+code ne peut PAS distinguer :
 *   (a) email inexistant       → doit retourner 401 { error: '2FA_INVALID' }
 *   (b) compte RIDER (non-PRO) → doit retourner 401 { error: '2FA_INVALID' }
 *   (c) compte PRO, mauvais code → 401 { error: '2FA_INVALID' }
 * - Seul un code valide pour un PRO retourne 200.
 *
 * Ces quatre cas doivent produire des réponses indistinguables pour (a), (b), (c).
 */

jest.mock('../../../lib/mailer', () => ({
  sendPasswordResetEmail: jest.fn(),
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  send2FACode: jest.fn().mockResolvedValue({ sent: true }),
}));

jest.mock('../../../services/cache.service', () => {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    cacheService: {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn(() => null),
      get: jest.fn(async (key: string) => {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) { store.delete(key); return null; }
        return entry.value;
      }),
      set: jest.fn(async (key: string, value: unknown, ttlSeconds = 300) => {
        store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return true;
      }),
      del: jest.fn(async (key: string) => { store.delete(key); return true; }),
      initialize: jest.fn(async () => undefined),
      __reset: () => store.clear(),
    },
  };
});

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { resetDb } from '../../../test-utils/resetDb';
import { createTestSession } from '../../../tests/helpers/auth';
import { send2FACode } from '../../../lib/mailer';
import { challengeCounter } from '../../../services/two-factor.service';

const mockSend2FACode = send2FACode as jest.MockedFunction<typeof send2FACode>;

const INVALID_BODY = { error: '2FA_INVALID' };

const app = createApp();

async function createUser(email: string, role: Role) {
  const hashed = await bcrypt.hash('Passw0rd!', 12);
  return prisma.user.create({
    data: {
      email,
      password: hashed,
      role,
      emailVerified: true,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
    },
  });
}

describe('POST /auth/2fa/verify — anti-énumération Option A', () => {
  beforeEach(async () => {
    await resetDb();
    challengeCounter.clear();
    mockSend2FACode.mockClear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('retourne 401 { error: 2FA_INVALID } pour un email inexistant — indistinguable du mauvais code', async () => {
    const session = await createTestSession(app);
    const res = await session
      .post('/auth/2fa/verify')
      .send({ email: 'no-such-user-verify@test.com', code: '123456' })
      .expect(401);

    expect(res.body).toMatchObject(INVALID_BODY);
    // Pas de 404, pas de "Utilisateur non trouvé"
    expect(res.body.error).not.toBe('Utilisateur non trouvé');
    expect(res.status).not.toBe(404);
  });

  it('retourne 401 { error: 2FA_INVALID } pour un compte RIDER — indistinguable du mauvais code', async () => {
    const session = await createTestSession(app);
    await createUser('rider-verify@test.com', Role.RIDER);

    const res = await session
      .post('/auth/2fa/verify')
      .send({ email: 'rider-verify@test.com', code: '123456' })
      .expect(401);

    expect(res.body).toMatchObject(INVALID_BODY);
    // Pas de 403, pas de "2FA disponible uniquement pour les pros"
    expect(res.body.error).not.toBe('2FA disponible uniquement pour les pros');
    expect(res.status).not.toBe(403);
  });

  it('retourne 401 { error: 2FA_INVALID } pour un compte PRO avec un mauvais code', async () => {
    const session = await createTestSession(app);
    await createUser('pro-wrong-code@test.com', Role.PRO);

    // D'abord envoyer un code pour créer un challenge
    await session.post('/auth/2fa/send').send({ email: 'pro-wrong-code@test.com' }).expect(200);

    const res = await session
      .post('/auth/2fa/verify')
      .send({ email: 'pro-wrong-code@test.com', code: '000000' })
      .expect(401);

    expect(res.body).toMatchObject(INVALID_BODY);
  });

  it('les trois cas échec (inexistant, rider, mauvais code) produisent le MÊME body 401', async () => {
    const session = await createTestSession(app);
    await createUser('pro-same-body@test.com', Role.PRO);
    await createUser('rider-same-body@test.com', Role.RIDER);

    // Send code pour avoir un challenge actif
    await session.post('/auth/2fa/send').send({ email: 'pro-same-body@test.com' }).expect(200);

    const [resInexistant, resRider, resMauvaisCode] = await Promise.all([
      session.post('/auth/2fa/verify').send({ email: 'nobody@test.com', code: '111111' }),
      session.post('/auth/2fa/verify').send({ email: 'rider-same-body@test.com', code: '111111' }),
      session.post('/auth/2fa/verify').send({ email: 'pro-same-body@test.com', code: '111111' }),
    ]);

    expect(resInexistant.status).toBe(401);
    expect(resRider.status).toBe(401);
    expect(resMauvaisCode.status).toBe(401);

    // Body identique dans tous les cas
    expect(resInexistant.body.error).toBe(resRider.body.error);
    expect(resRider.body.error).toBe(resMauvaisCode.body.error);
    expect(resInexistant.body.error).toBe('2FA_INVALID');
  });

  it('retourne 403 CONSENT_REQUIRED pour un PRO avec code valide mais sans consentement (pas 500)', async () => {
    // Preuve que le catch /2fa/verify gère CONSENT_REQUIRED et ne retourne pas 500.
    const session = await createTestSession(app);
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    // Créer un user PRO sans consentement
    await prisma.user.create({
      data: {
        email: 'pro-no-consent@test.com',
        password: hashed,
        role: Role.PRO,
        emailVerified: true,
        consentedAt: null,
        consentVersion: null,
      },
    });

    // Envoyer le code (ne nécessite pas de consentement)
    await session.post('/auth/2fa/send').send({ email: 'pro-no-consent@test.com' }).expect(200);

    const lastCall = mockSend2FACode.mock.calls.at(-1);
    const sentCode = lastCall?.[1];
    if (!sentCode || typeof sentCode !== 'string') throw new Error('No 2FA code captured');

    // consentAccepted absent → generateTokens lève CONSENT_REQUIRED → doit être 403 pas 500
    const res = await session
      .post('/auth/2fa/verify')
      .send({ email: 'pro-no-consent@test.com', code: sentCode, consentAccepted: false })
      .expect(403);

    expect(res.body.code).toBe('CONSENT_REQUIRED');
    expect(res.status).not.toBe(500);
  });

  it('retourne 200 ok: true pour un PRO avec code valide', async () => {
    const session = await createTestSession(app);
    await createUser('pro-valid-code@test.com', Role.PRO);

    // Envoyer le code
    await session.post('/auth/2fa/send').send({ email: 'pro-valid-code@test.com' }).expect(200);

    // Récupérer le code envoyé depuis le mock mailer
    const lastCall = mockSend2FACode.mock.calls.at(-1);
    const sentCode = lastCall?.[1];
    if (!sentCode || typeof sentCode !== 'string') {
      throw new Error('2FA code was not captured from mock');
    }

    const res = await session
      .post('/auth/2fa/verify')
      .send({ email: 'pro-valid-code@test.com', code: sentCode })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.message).toContain('réussie');
  });
});
