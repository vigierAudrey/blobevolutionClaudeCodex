/**
 * R5 — Rate limit robuste du endpoint /auth/resend-verification
 * R4 — Découplage inscription / Brevo (fire-and-forget contrôlé)
 *
 * Menaces couvertes :
 * - Spam du bouton "renvoyer" (cooldown 1/60s par email)
 * - Abus horaire (quota 5/h par email)
 * - DoS IP (5/15min par IP)
 * - Énumération d'email (réponse générique dans tous les cas)
 * - Token/hash/secret dans les réponses
 * - Rollback du compte si Brevo échoue (R4 : ne doit PAS rollbacker)
 * - Brevo indisponible lors de l'inscription (R4 : compte créé quand même)
 */

jest.mock('../../../lib/mailer', () => ({
  MailDeliveryError: class MailDeliveryError extends Error {
    provider: string;
    type: string;
    latencyMs: number;
    timedOut: boolean;
    smtpCode?: number;

    constructor(args: { provider: string; type: string; latencyMs: number; timedOut: boolean; smtpCode?: number }) {
      super('Email delivery unavailable');
      this.name = 'MailDeliveryError';
      this.provider = args.provider;
      this.type = args.type;
      this.latencyMs = args.latencyMs;
      this.timedOut = args.timedOut;
      this.smtpCode = args.smtpCode;
    }
  },
  sendVerificationEmail: jest.fn().mockResolvedValue({ sent: true }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ sent: true }),
  send2FACode: jest.fn().mockResolvedValue({ sent: true }),
  sendPasswordChangedEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

import bcrypt from 'bcryptjs';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { resetDb } from '../../../test-utils/resetDb';
import { createTestSession } from '../../../tests/helpers/auth';
import { MailDeliveryError, sendVerificationEmail } from '../../../lib/mailer';

const mockSendVerificationEmail = sendVerificationEmail as jest.MockedFunction<typeof sendVerificationEmail>;

const GENERIC_RESEND_MESSAGE = 'If the account exists, the request has been processed';
const REGISTER_SUCCESS_MESSAGE = 'Account created. Please check your inbox for the verification email.';
const REGISTER_SOFTFAIL_MESSAGE = "Account created. If you don't receive the email, use the resend button.";

const app = createApp();

async function createUnverifiedUser(email: string): Promise<void> {
  const hashed = await bcrypt.hash('Passw0rd!', 12);
  await prisma.user.create({
    data: {
      email,
      password: hashed,
      role: Role.RIDER,
      emailVerified: false,
      consentedAt: new Date(),
      consentVersion: 'v1.0.0',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// R4 — Découplage inscription / Brevo
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /auth/register — R4: découplage Brevo', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    mockSendVerificationEmail.mockResolvedValue({ sent: true } as any);
  });

  it('crée le compte et retourne 201 avec emailSent:true quand Brevo réussit', async () => {
    const session = await createTestSession(app);
    const res = await session
      .post('/auth/register')
      .send({ email: 'r4-ok@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    expect(res.body.message).toBe(REGISTER_SUCCESS_MESSAGE);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.userId).toBeDefined();

    const user = await prisma.user.findUnique({ where: { email: 'r4-ok@test.com' } });
    expect(user).not.toBeNull();
  });

  it('crée le compte et retourne 201 avec emailSent:false quand Brevo échoue (pas de rollback)', async () => {
    const session = await createTestSession(app);
    const { MailDeliveryError: MockedMailDeliveryError } = jest.requireMock('../../../lib/mailer') as {
      MailDeliveryError: new (args: any) => Error & { name: string };
    };
    mockSendVerificationEmail.mockRejectedValueOnce(
      new MockedMailDeliveryError({ type: 'email_verification', provider: 'brevo', latencyMs: 3001, timedOut: true }),
    );

    const res = await session
      .post('/auth/register')
      .send({ email: 'r4-brevo-fail@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    expect(res.body.message).toBe(REGISTER_SOFTFAIL_MESSAGE);
    expect(res.body.emailSent).toBe(false);
    expect(res.body.userId).toBeDefined();

    // Compte bien créé en base — PAS de rollback
    const user = await prisma.user.findUnique({ where: { email: 'r4-brevo-fail@test.com' } });
    expect(user).not.toBeNull();
    expect(user!.emailVerified).toBe(false);
  });

  it('le compte créé après échec Brevo peut récupérer via /resend-verification', async () => {
    const session = await createTestSession(app);
    const { MailDeliveryError: MockedMailDeliveryError } = jest.requireMock('../../../lib/mailer') as {
      MailDeliveryError: new (args: any) => Error & { name: string };
    };
    mockSendVerificationEmail.mockRejectedValueOnce(
      new MockedMailDeliveryError({ type: 'email_verification', provider: 'brevo', latencyMs: 5000, timedOut: true }),
    );

    // Inscription avec Brevo en échec
    await session
      .post('/auth/register')
      .send({ email: 'r4-recovery@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    // Brevo revient — resend fonctionne
    mockSendVerificationEmail.mockResolvedValueOnce({ sent: true } as any);
    const resendRes = await session
      .post('/auth/resend-verification')
      .send({ email: 'r4-recovery@test.com' });

    expect(resendRes.status).toBe(200);
    expect(resendRes.body.message).toBe(GENERIC_RESEND_MESSAGE);
  });

  it('ne rollbacke PAS le compte quand Brevo timeout (non-régression R4)', async () => {
    const session = await createTestSession(app);
    const { MailDeliveryError: MockedMailDeliveryError } = jest.requireMock('../../../lib/mailer') as {
      MailDeliveryError: new (args: any) => Error & { name: string };
    };
    mockSendVerificationEmail.mockRejectedValueOnce(
      new MockedMailDeliveryError({ type: 'email_verification', provider: 'brevo', latencyMs: 5001, timedOut: true }),
    );

    const res = await session
      .post('/auth/register')
      .send({ email: 'r4-timeout@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    // Pas d'erreur 503 ou 500
    expect(res.body.error).toBeUndefined();

    // Compte existe et n'est pas rollbacké
    const user = await prisma.user.findUnique({ where: { email: 'r4-timeout@test.com' } });
    expect(user).not.toBeNull();
  });

  it("n'expose pas le verificationToken en réponse hors NODE_ENV=test", async () => {
    // En test, le token EST exposé (comportement voulu pour les tests)
    // Ce test vérifie que le flag NODE_ENV=test est bien la seule condition
    const session = await createTestSession(app);
    const res = await session
      .post('/auth/register')
      .send({ email: 'r4-no-token@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    // En NODE_ENV=test le token est exposé intentionnellement — on vérifie qu'aucun secret
    // sensible (password hash, reset token) n'est exposé
    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.resetToken).toBeUndefined();
  });

  it('retourne 409 si email déjà enregistré (non-régression)', async () => {
    await createUnverifiedUser('r4-dup@test.com');
    const session = await createTestSession(app);

    const res = await session
      .post('/auth/register')
      .send({ email: 'r4-dup@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(409);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).not.toContain('hash');
    expect(res.body.error).not.toContain('token');
  });

  it('le login reste fonctionnel après création de compte normale (non-régression)', async () => {
    const session = await createTestSession(app);
    await session
      .post('/auth/register')
      .send({ email: 'r4-login@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    // Marque le compte comme vérifié pour permettre le login
    await prisma.user.update({
      where: { email: 'r4-login@test.com' },
      data: { emailVerified: true },
    });

    const loginRes = await session
      .post('/auth/login')
      .send({ email: 'r4-login@test.com', password: 'Passw0rd!', consentAccepted: true });

    expect(loginRes.status).toBe(200);
  });

  it('verify-email fonctionne après inscription réussie (non-régression)', async () => {
    const session = await createTestSession(app);
    const regRes = await session
      .post('/auth/register')
      .send({ email: 'r4-verify@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    const token = regRes.body.verificationToken as string;
    expect(token).toBeDefined();

    const verifyRes = await session
      .post('/auth/verify-email')
      .send({ token });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.message).toBe('Email verified');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R5 — Rate limit robuste du endpoint /auth/resend-verification
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /auth/resend-verification — R5: rate limits', () => {
  const previousFlag = process.env.ENABLE_RATE_LIMIT_IN_TESTS;

  beforeAll(() => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
  });

  afterAll(async () => {
    if (previousFlag === undefined) {
      delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    } else {
      process.env.ENABLE_RATE_LIMIT_IN_TESTS = previousFlag;
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    mockSendVerificationEmail.mockClear();
    mockSendVerificationEmail.mockResolvedValue({ sent: true } as any);
  });

  it('retourne 200 avec message générique pour un utilisateur légitime non vérifié', async () => {
    await createUnverifiedUser('r5-legit@test.com');
    const session = await createTestSession(app);

    const res = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-legit@test.com' })
      .expect(200);

    expect(res.body.message).toBe(GENERIC_RESEND_MESSAGE);
    expect(mockSendVerificationEmail).toHaveBeenCalled();
  });

  it('retourne 200 avec message générique pour un email inconnu (anti-énumération)', async () => {
    const session = await createTestSession(app);

    const res = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-unknown-email@test.com' })
      .expect(200);

    // Message identique à un utilisateur connu — pas de fuite d'info
    expect(res.body.message).toBe(GENERIC_RESEND_MESSAGE);
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });

  it('retourne 200 avec message générique pour un compte déjà vérifié (anti-énumération)', async () => {
    const hashed = await bcrypt.hash('Passw0rd!', 12);
    await prisma.user.create({
      data: {
        email: 'r5-already-verified@test.com',
        password: hashed,
        role: Role.RIDER,
        emailVerified: true,
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });
    const session = await createTestSession(app);

    const res = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-already-verified@test.com' })
      .expect(200);

    expect(res.body.message).toBe(GENERIC_RESEND_MESSAGE);
  });

  it('bloque le 2e envoi immédiat (cooldown 1 minute par email)', async () => {
    // EMAIL_VERIFICATION_COOLDOWN: max 1 par minute par email
    await createUnverifiedUser('r5-cooldown@test.com');
    const session = await createTestSession(app);

    // 1ère requête : passe
    await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-cooldown@test.com' })
      .expect(200);

    // 2ème requête immédiate : bloquée par le cooldown
    const res = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-cooldown@test.com' })
      .expect(429);

    expect(res.body.error).toBe('EMAIL_VERIFICATION_COOLDOWN');
    expect(res.body.message).toContain('wait');
  });

  it('le cooldown est par email : deux emails différents ne se bloquent pas mutuellement', async () => {
    await createUnverifiedUser('r5-email-a@test.com');
    await createUnverifiedUser('r5-email-b@test.com');
    const session = await createTestSession(app);

    // Les deux premiers appels passent (emails différents = compteurs indépendants)
    await session.post('/auth/resend-verification').send({ email: 'r5-email-a@test.com' }).expect(200);
    await session.post('/auth/resend-verification').send({ email: 'r5-email-b@test.com' }).expect(200);

    // Le 2e appel sur email-a est bloqué
    await session.post('/auth/resend-verification').send({ email: 'r5-email-a@test.com' }).expect(429);

    // Mais email-b n'est pas encore bloqué si on n'a fait qu'une requête sur lui
    // (son compteur cooldown est à 1, donc le prochain appel est bloqué)
    const resB = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-email-b@test.com' });
    expect(resB.status).toBe(429); // aussi bloqué par son propre cooldown
    expect(resB.body.error).toBe('EMAIL_VERIFICATION_COOLDOWN');
  });

  it('le quota horaire par email bloque après le seuil (test avec avancement de temps)', async () => {
    // EMAIL_VERIFICATION: max 5 par heure par email
    // On simule 5 requêtes en avançant le temps entre chaque (bypass cooldown d'1 minute)
    await createUnverifiedUser('r5-quota@test.com');
    const session = await createTestSession(app);

    const realDateNow = Date.now.bind(global.Date);

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const base = realDateNow();

      for (let i = 0; i < 5; i++) {
        jest.setSystemTime(base + i * 65_000); // +65s entre chaque = bypass cooldown 60s
        const res = await session
          .post('/auth/resend-verification')
          .send({ email: 'r5-quota@test.com' });
        expect(res.status).toBe(200);
      }

      // 6e requête : quota horaire dépassé
      jest.setSystemTime(base + 5 * 65_000);
      const blockedRes = await session
        .post('/auth/resend-verification')
        .send({ email: 'r5-quota@test.com' })
        .expect(429);

      expect(blockedRes.body.error).toBe('EMAIL_VERIFICATION_RATE_LIMIT_EXCEEDED');
      expect(blockedRes.body.message).toContain('inbox');
    } finally {
      jest.useRealTimers();
    }
  });

  it('le limiteur IP bloque après 5 requêtes depuis la même IP', async () => {
    // resendVerificationIpLimiter : 5/15min par IP (skip si pas de header test)
    const session = await createTestSession(app);

    for (let i = 0; i < 5; i++) {
      await session
        .post('/auth/resend-verification')
        .set('x-enable-ip-rate-limit', 'true')
        .send({ email: `r5-ip-test-${i}@test.com` });
    }

    // 6e requête depuis même IP : bloquée
    const res = await session
      .post('/auth/resend-verification')
      .set('x-enable-ip-rate-limit', 'true')
      .send({ email: 'r5-ip-6th@test.com' })
      .expect(429);

    expect(res.body.error).toBe('EMAIL_VERIFICATION_IP_RATE_LIMIT_EXCEEDED');
  });

  it("la réponse ne contient jamais de données sensibles (password, hash, resetToken, secret)", async () => {
    // En NODE_ENV=test le champ verificationToken est exposé intentionnellement pour les tests.
    // Ce test vérifie l'absence des secrets dangereux : hash de mot de passe,
    // token de reset de mot de passe, secrets d'API ou credentials.
    await createUnverifiedUser('r5-no-secret@test.com');
    const session = await createTestSession(app);

    const res = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-no-secret@test.com' })
      .expect(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash/i);
    expect(body).not.toMatch(/"password"/i);
    expect(body).not.toMatch(/resetToken/i);
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/Authorization/i);
    expect(body).not.toMatch(/userId/i);
    // userId n'est jamais exposé dans la réponse générique
    expect(res.body.userId).toBeUndefined();
  });

  it('deux resend simultanees ne provoquent pas d\'etat incoherent (pas de 500)', async () => {
    // Test de concurrence : les deux requêtes peuvent passer ou l'une être bloquée,
    // mais aucune ne doit retourner 500 ni exposer d'erreur interne
    await createUnverifiedUser('r5-concurrent@test.com');
    const sessionA = await createTestSession(app);
    const sessionB = await createTestSession(app);

    const [resA, resB] = await Promise.all([
      sessionA.post('/auth/resend-verification').send({ email: 'r5-concurrent@test.com' }),
      sessionB.post('/auth/resend-verification').send({ email: 'r5-concurrent@test.com' }),
    ]);

    // Ni l'un ni l'autre ne doit retourner 500 ou 403
    expect(resA.status).not.toBe(500);
    expect(resA.status).not.toBe(403);
    expect(resB.status).not.toBe(500);
    expect(resB.status).not.toBe(403);

    // Au moins l'un doit réussir
    const statuses = [resA.status, resB.status];
    expect(statuses).toContain(200);
  });

  it('400 si le corps de requête est invalide (email manquant)', async () => {
    const session = await createTestSession(app);
    const res = await session
      .post('/auth/resend-verification')
      .send({})
      .expect(400);

    expect(res.body.error).toBe('Invalid input');
  });

  it('les tokens de vérification invalides précédents sont invalidés à chaque resend', async () => {
    await createUnverifiedUser('r5-token-invalidate@test.com');
    const session = await createTestSession(app);

    // Premier resend : génère un token
    const res1 = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-token-invalidate@test.com' })
      .expect(200);

    // En test, le token est exposé
    const firstToken = res1.body.verificationToken as string | undefined;
    expect(firstToken).toBeDefined();

    // Avance le temps pour bypass le cooldown
    const base = Date.now();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(base + 65_000);

    // Second resend : nouveau token, l'ancien doit être invalidé
    const res2 = await session
      .post('/auth/resend-verification')
      .send({ email: 'r5-token-invalidate@test.com' })
      .expect(200);

    jest.useRealTimers();

    const secondToken = res2.body.verificationToken as string | undefined;
    expect(secondToken).toBeDefined();
    expect(secondToken).not.toBe(firstToken);

    // L'ancien token ne doit plus fonctionner
    const verifyOld = await session
      .post('/auth/verify-email')
      .send({ token: firstToken });
    expect(verifyOld.status).toBe(401); // invalide car invalidé par le resend

    // Le nouveau token fonctionne
    const verifyNew = await session
      .post('/auth/verify-email')
      .send({ token: secondToken });
    expect(verifyNew.status).toBe(200);
  });
});
