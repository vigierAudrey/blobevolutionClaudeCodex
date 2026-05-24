/**
 * C17 — Data minimization tests for POST /contact/request.
 *
 * Oracles :
 *  - DTO réponse exact : success, contactRequest.{id, message, proName, createdAt}
 *  - aucun email dans la réponse sérialisée
 *  - aucun objet pro imbriqué (user complet, password, consentIp, etc.)
 *  - aucun proProfile complet exposé
 *  - aucun objet conversation imbriqué
 *  - aucun members / riderProfile dans la réponse
 *  - aucun userId (proUserId, riderId)
 *  - proName = businessName ou 'Professionnel' (fallback)
 *  - rate limit C11 inchangé (5/10min)
 *  - P2002 catch inchangé (409 sur doublon)
 */

import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { cleanupTestUsers, createTestUser } from '../../../test-utils';

type Role = 'RIDER' | 'PRO' | 'ADMIN';
const app = createApp();

const emails = {
  pro: 'c17-pro@test.com',
  proNoProfile: 'c17-pro-noprofile@test.com',
  rider: 'c17-rider@test.com',
};

function ensureSecrets() {
  process.env.JWT_SECRET ||= 'test-jwt-secret';
  process.env.SESSION_SECRET ||= 'test-session-secret';
}

function signToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

async function getCsrf(agent: SuperAgentTest) {
  const res = await agent.get('/csrf-token').expect(200);
  return res.body.csrfToken as string;
}

async function cleanupFixture() {
  await cleanupTestUsers(Object.values(emails));
}

type Fixture = {
  proId: string;
  proNoProfileId: string;
  riderId: string;
  proToken: string;
  proNoProfileToken: string;
  riderToken: string;
  conversationId: string;
  conversationNoProfileId: string;
};

let fixture: Fixture;

async function seedFixture(): Promise<Fixture> {
  ensureSecrets();
  await cleanupFixture();

  const pro = await createTestUser({ email: emails.pro, password: 'hash', role: 'PRO', emailVerified: true });
  await prisma.proProfile.create({ data: { userId: pro.id, businessName: 'BlobSurf Pro C17' } });

  const proNoProfile = await createTestUser({ email: emails.proNoProfile, password: 'hash', role: 'PRO', emailVerified: true });

  const rider = await createTestUser({ email: emails.rider, password: 'hash', role: 'RIDER', emailVerified: true });
  await prisma.riderProfile.create({
    data: { userId: rider.id, displayName: 'Test Rider C17', wantsLesson: true, lat: 43.7, lng: -1.7 },
  });

  // Match pro ↔ rider (cas nominal)
  const matchA = await prisma.match.create({ data: { userOneId: pro.id, userTwoId: rider.id } });
  const convA = await prisma.conversation.create({ data: { matchId: matchA.id, type: 'RIDER_TO_RIDER' } });
  await prisma.conversationMember.create({ data: { conversationId: convA.id, userId: rider.id } });

  // Match proNoProfile ↔ rider (fallback proName)
  const matchB = await prisma.match.create({ data: { userOneId: proNoProfile.id, userTwoId: rider.id } });
  const convB = await prisma.conversation.create({ data: { matchId: matchB.id, type: 'RIDER_TO_RIDER' } });
  await prisma.conversationMember.create({ data: { conversationId: convB.id, userId: rider.id } });

  return {
    proId: pro.id,
    proNoProfileId: proNoProfile.id,
    riderId: rider.id,
    proToken: signToken(pro.id, 'PRO'),
    proNoProfileToken: signToken(proNoProfile.id, 'PRO'),
    riderToken: signToken(rider.id, 'RIDER'),
    conversationId: convA.id,
    conversationNoProfileId: convB.id,
  };
}

beforeEach(async () => {
  fixture = await seedFixture();
});

afterAll(async () => {
  await cleanupFixture();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function postContactRequest(
  conversationId: string,
  token: string,
  message?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const agent = request.agent(app);
  const csrf = await getCsrf(agent);
  const payload: Record<string, unknown> = { conversationId };
  if (message !== undefined) payload.message = message;
  const res = await agent
    .post('/contact/request')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', csrf)
    .send(payload);
  return { status: res.status, body: res.body as Record<string, unknown> };
}

// ─── DTO shape ────────────────────────────────────────────────────────────────

describe('POST /contact/request — DTO minimal (C17)', () => {
  it('retourne success:true et contactRequest avec exactement les champs id, message, proName, createdAt', async () => {
    const { status, body } = await postContactRequest(fixture.conversationId, fixture.proToken, 'Bonjour !');
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).toBeDefined();

    const allowedKeys = new Set(['id', 'message', 'proName', 'createdAt']);
    const unexpectedKeys = Object.keys(cr).filter(k => !allowedKeys.has(k));
    expect(unexpectedKeys).toEqual([]);
  });

  it('id est un string UUID', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(typeof cr.id).toBe('string');
    expect(cr.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('message est préservé dans la réponse', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken, 'Mon message C17');
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr.message).toBe('Mon message C17');
  });

  it('message est null quand non fourni', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr.message).toBeNull();
  });

  it('createdAt est un string ISO', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(typeof cr.createdAt).toBe('string');
    expect(() => new Date(cr.createdAt as string)).not.toThrow();
  });

  it('proName est le businessName du pro (string, pas objet imbriqué)', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(typeof cr.proName).toBe('string');
    expect(cr.proName).toBe('BlobSurf Pro C17');
  });

  it('proName repasse à "Professionnel" quand le pro n\'a pas de proProfile', async () => {
    const { body } = await postContactRequest(fixture.conversationNoProfileId, fixture.proNoProfileToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr.proName).toBe('Professionnel');
  });
});

// ─── Anti-fuite : champs interdits ───────────────────────────────────────────

describe('POST /contact/request — aucun champ sensible exposé (C17)', () => {
  it('ne contient aucun email dans la réponse sérialisée', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/@test\.com/);
    expect(serialized).not.toContain('email');
  });

  it('ne contient pas d\'objet pro imbriqué (user complet)', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).not.toHaveProperty('pro');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('consentIp');
    expect(serialized).not.toContain('credentialsVersion');
    expect(serialized).not.toContain('sessionVersion');
  });

  it('ne contient pas de proProfile complet comme objet dans la réponse', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).not.toHaveProperty('proProfile');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('proProfile');
  });

  it('ne contient pas d\'objet conversation imbriqué', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).not.toHaveProperty('conversation');
  });

  it('ne contient pas members dans la réponse', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('members');
  });

  it('ne contient pas riderProfile dans la réponse (lat/lng du rider)', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('riderProfile');
    // Coordonnées précises du rider (lat=43.7, lng=-1.7) ne doivent pas fuiter
    expect(serialized).not.toContain('43.7');
    expect(serialized).not.toContain('-1.7');
  });

  it('ne contient pas le proUserId dans la réponse', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).not.toHaveProperty('proUserId');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.proId);
  });

  it('ne contient pas le riderId dans la réponse', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.riderId);
  });

  it('ne contient pas lessonRequestId dans la réponse publique', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).not.toHaveProperty('lessonRequestId');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('lessonRequestId');
  });

  it('ne contient pas status dans contactRequest (status interne, pas exposé au create)', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).not.toHaveProperty('status');
  });

  it('ne contient pas conversationId dans contactRequest (non exposé au create)', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    const cr = body.contactRequest as Record<string, unknown>;
    expect(cr).not.toHaveProperty('conversationId');
  });
});

// ─── Invariants métier préservés ──────────────────────────────────────────────

describe('POST /contact/request — invariants métier préservés (C17)', () => {
  it('le ContactRequest est bien stocké en DB avec status PENDING', async () => {
    const { body } = await postContactRequest(fixture.conversationId, fixture.proToken, 'Test DB');
    const cr = body.contactRequest as Record<string, unknown>;
    const stored = await prisma.contactRequest.findUnique({ where: { id: cr.id as string } });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('PENDING');
    expect(stored?.message).toBe('Test DB');
  });

  it('409 sur doublon (P2002 catch inchangé)', async () => {
    await postContactRequest(fixture.conversationId, fixture.proToken);
    const { status, body } = await postContactRequest(fixture.conversationId, fixture.proToken);
    expect(status).toBe(409);
    expect(body.error).toBe('Contact request already exists for this conversation');
  });

  it('403 pour un rider (non-pro)', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.riderToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId });
    expect(res.status).toBe(403);
  });

  it('401 sans token', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent
      .post('/contact/request')
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId });
    expect(res.status).toBe(401);
  });
});
