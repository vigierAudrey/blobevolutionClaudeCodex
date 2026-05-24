/**
 * C11 — Tests anti-abus POST /contact/request
 *
 * Couvre :
 *   - doublon même (proUserId, conversationId) → 409
 *   - re-soumission après REJECTED → 409
 *   - autre pro (proB) pour la même conversation → 404 IDOR (proB pas dans le match)
 *   - autre pro (proB) pour SA conversation → 200 (contrainte per-pro)
 *   - spam rapide au-delà du rate limit → 429 (ENABLE_RATE_LIMIT_IN_TESTS=true)
 *   - métriques C10 non gonflées : COUNT(cr.id) stable après tentatives en double
 *   - race condition simulée : Promise.all → [200, 409]
 */

import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { cleanupTestUsers, createTestUser } from '../../../test-utils';

type Role = 'RIDER' | 'PRO';

const app = createApp();

const emails = {
  pro:      'abuse-pro@test.com',
  proB:     'abuse-prob@test.com',
  riderOne: 'abuse-rider1@test.com',
};

type AbuseFixture = {
  proId: string;
  proBId: string;
  riderOneId: string;
  proToken: string;
  proBToken: string;
  riderOneToken: string;
  conversationId: string;   // pro ↔ riderOne (wantsLesson=true)
  conversationBId: string;  // proB ↔ riderOne (wantsLesson=true)
};

let fixture: AbuseFixture;

function ensureSecrets() {
  process.env.JWT_SECRET    ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function getCsrf(agent: SuperAgentTest) {
  const res = await agent.get('/csrf-token').expect(200);
  return res.body.csrfToken as string;
}

async function cleanupFixtureData() {
  await cleanupTestUsers(Object.values(emails));
}

async function seedAbuseFixture(): Promise<AbuseFixture> {
  ensureSecrets();
  await cleanupFixtureData();

  const pro = await createTestUser({
    email: emails.pro, password: 'hash', role: 'PRO', emailVerified: true,
  });
  await prisma.proProfile.create({ data: { userId: pro.id, businessName: 'Abuse Pro' } });

  const proB = await createTestUser({
    email: emails.proB, password: 'hash', role: 'PRO', emailVerified: true,
  });
  await prisma.proProfile.create({ data: { userId: proB.id, businessName: 'Abuse Pro B' } });

  const riderOne = await createTestUser({
    email: emails.riderOne, password: 'hash', role: 'RIDER', emailVerified: true,
  });
  await prisma.riderProfile.create({
    data: { userId: riderOne.id, displayName: 'Abuse Rider', wantsLesson: true },
  });

  // Match A : pro ↔ riderOne
  const matchA = await prisma.match.create({
    data: { userOneId: pro.id, userTwoId: riderOne.id },
  });
  const convA = await prisma.conversation.create({
    data: { matchId: matchA.id, type: 'RIDER_TO_RIDER' },
  });
  await prisma.conversationMember.create({
    data: { conversationId: convA.id, userId: riderOne.id },
  });

  // Match B : proB ↔ riderOne (même rider, pro différent)
  const matchB = await prisma.match.create({
    data: { userOneId: proB.id, userTwoId: riderOne.id },
  });
  const convB = await prisma.conversation.create({
    data: { matchId: matchB.id, type: 'RIDER_TO_RIDER' },
  });
  await prisma.conversationMember.create({
    data: { conversationId: convB.id, userId: riderOne.id },
  });

  return {
    proId: pro.id,
    proBId: proB.id,
    riderOneId: riderOne.id,
    proToken: signToken(pro.id, 'PRO'),
    proBToken: signToken(proB.id, 'PRO'),
    riderOneToken: signToken(riderOne.id, 'RIDER'),
    conversationId: convA.id,
    conversationBId: convB.id,
  };
}

beforeEach(async () => {
  fixture = await seedAbuseFixture();
});

afterAll(async () => {
  await cleanupFixtureData();
});

// ─── Doublon ──────────────────────────────────────────────────────────────────

describe('POST /contact/request — anti-doublon', () => {
  it('rejects a second ContactRequest for the same (proUserId, conversationId) with 409', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    // Première demande — succès
    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(200);

    // Deuxième demande — même (pro, conversation) → 409
    const dup = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(409);

    expect(dup.body.error).toBe('Contact request already exists for this conversation');
  });

  it('rejects re-submission after REJECTED (not just PENDING)', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const creation = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(200);

    const contactRequestId = creation.body.contactRequest.id as string;

    // Rider refuse
    const riderAgent = request.agent(app);
    const riderCsrf = await getCsrf(riderAgent);
    await riderAgent
      .post('/contact/respond')
      .set('Authorization', `Bearer ${fixture.riderOneToken}`)
      .set('X-CSRF-Token', riderCsrf)
      .send({ contactRequestId, response: 'REJECT' })
      .expect(200);

    const stored = await prisma.contactRequest.findUnique({ where: { id: contactRequestId } });
    expect(stored?.status).toBe('REJECTED');

    // Re-soumission après REJECTED → 409 (pas 200)
    const retry = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(409);

    expect(retry.body.error).toBe('Contact request already exists for this conversation');
  });

  it('allows a different pro (proB) to send a ContactRequest to their own conversation', async () => {
    const agentA = request.agent(app);
    const csrfA = await getCsrf(agentA);
    const agentB = request.agent(app);
    const csrfB = await getCsrf(agentB);

    // pro → conversationId : OK
    await agentA
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrfA)
      .send({ conversationId: fixture.conversationId })
      .expect(200);

    // proB → conversationBId (propre match) : OK — contrainte unique est par (pro, conversation)
    const resB = await agentB
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proBToken}`)
      .set('X-CSRF-Token', csrfB)
      .send({ conversationId: fixture.conversationBId })
      .expect(200);

    expect(resB.body.success).toBe(true);
  });

  it('returns 404 when proB tries conversationId (IDOR — proB not in that match)', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proBToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(404);
  });
});

// ─── Race condition ───────────────────────────────────────────────────────────

describe('POST /contact/request — race condition', () => {
  it('guarantees exactly one ContactRequest is created when two concurrent requests race', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const [csrfA, csrfB] = await Promise.all([getCsrf(agentA), getCsrf(agentB)]);

    const [resA, resB] = await Promise.all([
      agentA
        .post('/contact/request')
        .set('Authorization', `Bearer ${fixture.proToken}`)
        .set('X-CSRF-Token', csrfA)
        .send({ conversationId: fixture.conversationId }),
      agentB
        .post('/contact/request')
        .set('Authorization', `Bearer ${fixture.proToken}`)
        .set('X-CSRF-Token', csrfB)
        .send({ conversationId: fixture.conversationId }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Une seule requête crée le ContactRequest, l'autre est bloquée (409 ou 500 interne)
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(409);

    // Exactement un ContactRequest en base
    const rows = await prisma.contactRequest.findMany({
      where: { proUserId: fixture.proId, conversationId: fixture.conversationId },
    });
    expect(rows).toHaveLength(1);
  });
});

// ─── Rate limit ───────────────────────────────────────────────────────────────

describe('POST /contact/request — rate limit (ENABLE_RATE_LIMIT_IN_TESTS)', () => {
  const originalEnv = process.env.ENABLE_RATE_LIMIT_IN_TESTS;

  beforeAll(() => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    } else {
      process.env.ENABLE_RATE_LIMIT_IN_TESTS = originalEnv;
    }
  });

  it('returns 429 after exceeding 5 contact requests within the rate-limit window', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await agent
        .post('/contact/request')
        .set('Authorization', `Bearer ${fixture.proToken}`)
        .set('X-CSRF-Token', csrf)
        .send({ conversationId: fixture.conversationId });
      statuses.push(res.status);
    }

    // Les 5 premières passent le rate limiter (200 ou 409)
    expect(statuses.slice(0, 5).every(s => s !== 429)).toBe(true);
    // La 6ème est bloquée par le rate limiter
    expect(statuses[5]).toBe(429);
  });
});

// ─── Métriques C10 ────────────────────────────────────────────────────────────

describe('POST /contact/request — C10 metric integrity', () => {
  it('does not inflate raw ContactRequest count when duplicates are blocked', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    // Première demande
    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(200);

    // Tentative doublon bloquée
    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(409);

    // Uniquement 1 ligne en base — COUNT(cr.id) dans C10 reste à 1
    const rows = await prisma.contactRequest.findMany({
      where: { proUserId: fixture.proId, conversationId: fixture.conversationId },
    });
    expect(rows).toHaveLength(1);
  });

  it('does not inflate count even after a REJECTED re-submission attempt', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const creation = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(200);

    const contactRequestId = creation.body.contactRequest.id as string;

    // Rider refuse
    const riderAgent = request.agent(app);
    const riderCsrf = await getCsrf(riderAgent);
    await riderAgent
      .post('/contact/respond')
      .set('Authorization', `Bearer ${fixture.riderOneToken}`)
      .set('X-CSRF-Token', riderCsrf)
      .send({ contactRequestId, response: 'REJECT' })
      .expect(200);

    // Tentative de re-soumission après REJECTED
    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(409);

    // Toujours exactement 1 ligne — les métriques C10 (COUNT cr.id) ne sont pas gonflées
    const rows = await prisma.contactRequest.findMany({
      where: { proUserId: fixture.proId, conversationId: fixture.conversationId },
    });
    expect(rows).toHaveLength(1);
  });
});
