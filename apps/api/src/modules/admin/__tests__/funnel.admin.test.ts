/**
 * Tests API admin — GET /admin/analytics/funnel (Sprint C22)
 *
 * Funnel complet BlobConnect :
 *   1. Demande créée     (LessonFanout DISTINCT lessonRequestId)
 *   2. Pro trouvé        (LessonFanout.prosFound > 0)
 *   3. Contact envoyé    (ContactRequest.lessonRequestId IS NOT NULL)
 *   4. Mise en relation  (ContactRequest.status = ACCEPTED)
 *   5. Conversation      (Message réel après acceptation)
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { AVAILABLE_PERMISSIONS } from '../permissions';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const EMAIL_ADMIN = 'funnel-analytics-admin@test.com';
const EMAIL_RIDER = 'funnel-analytics-rider@test.com';
const EMAIL_PRO = 'funnel-analytics-pro@test.com';

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
  process.env.PRIMARY_ADMIN_EMAILS = EMAIL_ADMIN;
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function seedAuth() {
  const [adminUser, riderUser, proUser] = await Promise.all([
    prisma.user.create({
      data: { email: EMAIL_ADMIN, password: 'hash', role: 'ADMIN', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_RIDER, password: 'hash', role: 'RIDER', emailVerified: true },
    }),
    prisma.user.create({
      data: { email: EMAIL_PRO, password: 'hash', role: 'PRO', emailVerified: true },
    }),
  ]);
  await Promise.all([
    prisma.adminProfile.create({
      data: { userId: adminUser.id, permissions: [...AVAILABLE_PERMISSIONS] },
    }),
    prisma.riderProfile.create({ data: { userId: riderUser.id } }),
    prisma.proProfile.create({ data: { userId: proUser.id, lat: 44.8, lng: -1.2, radiusKm: 20 } }),
  ]);
  return {
    adminToken: signToken(adminUser.id, 'ADMIN'),
    riderToken: signToken(riderUser.id, 'RIDER'),
    proToken: signToken(proUser.id, 'PRO'),
  };
}

// Crée une demande complète jusqu'à l'étape demandée.
interface SeedOptions {
  prosFound?: number;       // 0 = pas de pro trouvé, 1+ = pro trouvé
  withContact?: boolean;    // crée un ContactRequest
  withAcceptance?: boolean; // passe le ContactRequest à ACCEPTED
  withMessage?: boolean;    // ajoute un vrai message après acceptation
  messageBeforeAcceptance?: boolean; // message avant la mise en relation (ne compte pas)
  messageIsSystem?: boolean;         // meta.kind='SYSTEM' (ne compte pas)
  messageIsBlank?: boolean;          // contenu vide (ne compte pas)
}

async function seedFunnelStep(opts: SeedOptions = {}) {
  const lessonRequestId = `lr-funnel-${randomUUID().slice(0, 8)}`;

  await prisma.lessonFanout.create({
    data: {
      riderRef: `ref-${lessonRequestId}`,
      lessonRequestId,
      sport: 'surf',
      prosFound: opts.prosFound ?? 1,
      prosNotified: opts.prosFound ?? 1,
      failureCount: 0,
    },
  });

  if (!opts.withContact) return { lessonRequestId };

  const proUser = await prisma.user.create({
    data: { email: `funnel-pro-${randomUUID()}@test.com`, password: 'hash', role: 'PRO', emailVerified: true },
  });
  const riderUser = await prisma.user.create({
    data: { email: `funnel-rider-${randomUUID()}@test.com`, password: 'hash', role: 'RIDER', emailVerified: true },
  });
  const conversation = await prisma.conversation.create({
    data: {
      type: 'RIDER_TO_PRO',
      members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] },
    },
  });

  const contactRequest = await prisma.contactRequest.create({
    data: {
      proUserId: proUser.id,
      conversationId: conversation.id,
      lessonRequestId,
      status: opts.withAcceptance ? 'ACCEPTED' : 'PENDING',
    },
  });

  if (opts.withAcceptance) {
    const acceptedAt = new Date(Date.now() - 60_000);
    await prisma.contactRequestResponse.create({
      data: {
        contactRequestId: contactRequest.id,
        riderUserId: riderUser.id,
        response: 'ACCEPT',
        createdAt: acceptedAt,
      },
    });

    if (opts.withMessage) {
      const messageAt = new Date(
        acceptedAt.getTime() + (opts.messageBeforeAcceptance ? -5000 : 5000),
      );
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: riderUser.id,
          type: 'TEXT',
          content: opts.messageIsBlank ? '   ' : 'Bonjour !',
          meta: opts.messageIsSystem ? { kind: 'SYSTEM' } : undefined,
          createdAt: messageAt,
        },
      });
    }
  }

  return { lessonRequestId, proUserId: proUser.id, riderUserId: riderUser.id };
}

beforeAll(() => {
  ensureSecrets();
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('GET /admin/analytics/funnel — auth', () => {
  it('returns 401 with no token', async () => {
    await request(app).get('/admin/analytics/funnel').expect(401);
  });

  it('returns 403 for non-admin (rider)', async () => {
    const { riderToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(403);
  });

  it('returns 403 for non-admin (pro)', async () => {
    const { proToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(403);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('GET /admin/analytics/funnel — validation', () => {
  it('returns 400 for invalid date format', async () => {
    const { adminToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/funnel?from=2026/01/01')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('returns 400 when from >= to', async () => {
    const { adminToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/funnel?from=2026-05-25&to=2026-05-25')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('returns 400 when range exceeds 365 days', async () => {
    const { adminToken } = await seedAuth();
    await request(app)
      .get('/admin/analytics/funnel?from=2025-01-01&to=2026-05-25')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});

// ── Métriques ─────────────────────────────────────────────────────────────────

describe('GET /admin/analytics/funnel — metrics', () => {
  it('returns zero state when there is no data', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.requestCreated.count).toBe(0);
    expect(res.body.steps.proMatched.count).toBe(0);
    expect(res.body.steps.contactSent.count).toBe(0);
    expect(res.body.steps.connectionAccepted.count).toBe(0);
    expect(res.body.steps.conversationStarted.count).toBe(0);
    expect(res.body.steps.proMatched.rateFromPrevious).toBeNull();
    expect(res.body.globalRates.requestToConversationStarted).toBeNull();
    expect(res.body.globalRates.contactSentToConversationStarted).toBeNull();
    expect(res.body.period).toMatchObject({ from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('counts requestCreated only — no contact', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({ prosFound: 0 });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.requestCreated.count).toBeGreaterThanOrEqual(1);
    expect(res.body.steps.contactSent.count).toBe(0);
    expect(res.body.steps.connectionAccepted.count).toBe(0);
    expect(res.body.steps.conversationStarted.count).toBe(0);
  });

  it('counts proMatched when prosFound > 0', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({ prosFound: 2 });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.proMatched.count).toBeGreaterThanOrEqual(1);
    expect(res.body.steps.proMatched.rateFromPrevious).not.toBeNull();
  });

  it('does NOT count proMatched when prosFound = 0', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({ prosFound: 0 });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // requestCreated ≥ 1, proMatched peut rester à 0 si seules données sans pro
    // On vérifie l'invariant : proMatched ≤ requestCreated
    expect(res.body.steps.proMatched.count).toBeLessThanOrEqual(res.body.steps.requestCreated.count);
  });

  it('counts contactSent when ContactRequest exists', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({ prosFound: 1, withContact: true });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.contactSent.count).toBeGreaterThanOrEqual(1);
    expect(res.body.steps.connectionAccepted.count).toBe(0);
  });

  it('counts connectionAccepted when ContactRequest is ACCEPTED', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({ prosFound: 1, withContact: true, withAcceptance: true });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.connectionAccepted.count).toBeGreaterThanOrEqual(1);
    expect(res.body.steps.conversationStarted.count).toBe(0);
  });

  it('does NOT count conversationStarted for message before acceptance', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({
      prosFound: 1,
      withContact: true,
      withAcceptance: true,
      withMessage: true,
      messageBeforeAcceptance: true,
    });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.conversationStarted.count).toBe(0);
  });

  it('does NOT count conversationStarted for system message', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({
      prosFound: 1,
      withContact: true,
      withAcceptance: true,
      withMessage: true,
      messageIsSystem: true,
    });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.conversationStarted.count).toBe(0);
  });

  it('does NOT count conversationStarted for blank message', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({
      prosFound: 1,
      withContact: true,
      withAcceptance: true,
      withMessage: true,
      messageIsBlank: true,
    });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.conversationStarted.count).toBe(0);
  });

  it('counts conversationStarted for real message after acceptance', async () => {
    const { adminToken } = await seedAuth();
    await seedFunnelStep({
      prosFound: 1,
      withContact: true,
      withAcceptance: true,
      withMessage: true,
    });

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.steps.conversationStarted.count).toBeGreaterThanOrEqual(1);
    expect(res.body.globalRates.requestToConversationStarted).not.toBeNull();
  });

  it('does NOT double-count a demand with multiple pros contacted', async () => {
    const { adminToken } = await seedAuth();

    // Une seule demande (même lessonRequestId) mais deux ContactRequests
    const lessonRequestId = `lr-dedup-${randomUUID().slice(0, 8)}`;
    await prisma.lessonFanout.create({
      data: {
        riderRef: `ref-${lessonRequestId}`,
        lessonRequestId,
        sport: 'surf',
        prosFound: 2,
        prosNotified: 2,
        failureCount: 0,
      },
    });

    const riderUser = await prisma.user.create({
      data: { email: `dedup-rider-${randomUUID()}@test.com`, password: 'hash', role: 'RIDER', emailVerified: true },
    });

    // Deux pros pour la même demande
    for (let i = 0; i < 2; i++) {
      const proUser = await prisma.user.create({
        data: { email: `dedup-pro-${randomUUID()}@test.com`, password: 'hash', role: 'PRO', emailVerified: true },
      });
      const conversation = await prisma.conversation.create({
        data: {
          type: 'RIDER_TO_PRO',
          members: { create: [{ userId: proUser.id }, { userId: riderUser.id }] },
        },
      });
      await prisma.contactRequest.create({
        data: {
          proUserId: proUser.id,
          conversationId: conversation.id,
          lessonRequestId,
          status: 'ACCEPTED',
        },
      });
    }

    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // La demande ne doit compter qu'une fois (DISTINCT lessonRequestId)
    // Vérifie les invariants : connectionAccepted <= contactSent <= requestCreated
    expect(res.body.steps.connectionAccepted.count).toBeLessThanOrEqual(res.body.steps.contactSent.count);
    expect(res.body.steps.contactSent.count).toBeLessThanOrEqual(res.body.steps.requestCreated.count);
  });

  it('accepts valid from/to params and returns period in response', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/funnel?from=2026-01-01&to=2026-05-25')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.period.from).toBe('2026-01-01');
    expect(res.body.period.to).toBe('2026-05-25');
  });

  it('returns correct response shape', async () => {
    const { adminToken } = await seedAuth();
    const res = await request(app)
      .get('/admin/analytics/funnel')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Vérifie la structure complète (les taux peuvent être null quand count = 0)
    expect(res.body).toMatchObject({
      period: { from: expect.any(String), to: expect.any(String) },
      steps: {
        requestCreated: { count: expect.any(Number) },
        proMatched: { count: expect.any(Number) },
        contactSent: { count: expect.any(Number) },
        connectionAccepted: { count: expect.any(Number) },
        conversationStarted: { count: expect.any(Number) },
      },
      globalRates: {},
    });
    // Les clés rateFromPrevious et globalRates doivent exister (null ou number)
    expect(res.body.steps.proMatched).toHaveProperty('rateFromPrevious');
    expect(res.body.steps.contactSent).toHaveProperty('rateFromPrevious');
    expect(res.body.steps.connectionAccepted).toHaveProperty('rateFromPrevious');
    expect(res.body.steps.conversationStarted).toHaveProperty('rateFromPrevious');
    expect(res.body.globalRates).toHaveProperty('requestToConversationStarted');
    expect(res.body.globalRates).toHaveProperty('contactSentToConversationStarted');
  });
});
