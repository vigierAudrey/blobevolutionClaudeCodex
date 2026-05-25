/**
 * C12 — Machine d'état POST /contact/respond
 *
 * Couvre :
 *   - ACCEPT puis REJECT (même rider)          → 409 ALREADY_RESPONDED
 *   - REJECT puis ACCEPT (même rider)          → 409 ALREADY_RESPONDED
 *   - Double ACCEPT (même rider)               → 409 ALREADY_RESPONDED
 *   - Double REJECT (même rider)               → 409 ALREADY_RESPONDED
 *   - ACCEPT après ACCEPTED (statut final)     → 409 CONTACT_REQUEST_ALREADY_RESOLVED
 *   - REJECT après REJECTED (statut final)     → 409 CONTACT_REQUEST_ALREADY_RESOLVED
 *   - Concurrence ACCEPT simultanée            → [200, 409]
 *   - Cohérence ConversationMember après ACCEPT → pro ajouté exactement une fois
 *   - Pro ne peut pas répondre à sa propre demande → 403
 *   - Rider hors conversation                  → 403
 *   - ContactRequest inexistant               → 404
 */

import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { cleanupTestUsers, createTestUser } from '../../../test-utils';

type Role = 'RIDER' | 'PRO';

const app = createApp();

const emails = {
  pro: 'sm-pro@test.com',
  rider: 'sm-rider@test.com',
  outsider: 'sm-outsider@test.com',
};

type SMFixture = {
  proId: string;
  riderId: string;
  outsiderId: string;
  proToken: string;
  riderToken: string;
  outsiderToken: string;
  conversationId: string;
};

let fixture: SMFixture;

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

async function cleanupFixtureData() {
  await cleanupTestUsers(Object.values(emails));
}

async function seedSMFixture(): Promise<SMFixture> {
  ensureSecrets();
  await cleanupFixtureData();

  const pro = await createTestUser({
    email: emails.pro, password: 'hash', role: 'PRO', emailVerified: true,
  });
  await prisma.proProfile.create({ data: { userId: pro.id, businessName: 'SM Pro' } });

  const rider = await createTestUser({
    email: emails.rider, password: 'hash', role: 'RIDER', emailVerified: true,
  });
  await prisma.riderProfile.create({
    data: { userId: rider.id, displayName: 'SM Rider', wantsLesson: true },
  });

  const outsider = await createTestUser({
    email: emails.outsider, password: 'hash', role: 'RIDER', emailVerified: true,
  });
  await prisma.riderProfile.create({
    data: { userId: outsider.id, displayName: 'SM Outsider', wantsLesson: false },
  });

  const match = await prisma.match.create({
    data: { userOneId: pro.id, userTwoId: rider.id },
  });
  const conversation = await prisma.conversation.create({
    data: { matchId: match.id, type: 'RIDER_TO_RIDER' },
  });
  // Seul le rider est membre initial — le pro rejoint à l'ACCEPT
  await prisma.conversationMember.create({
    data: { conversationId: conversation.id, userId: rider.id },
  });

  return {
    proId: pro.id,
    riderId: rider.id,
    outsiderId: outsider.id,
    proToken: signToken(pro.id, 'PRO'),
    riderToken: signToken(rider.id, 'RIDER'),
    outsiderToken: signToken(outsider.id, 'RIDER'),
    conversationId: conversation.id,
  };
}

/** Crée un ContactRequest PENDING via la DB directement (bypass anti-doublon UI). */
async function createPendingRequest(fixture: SMFixture): Promise<string> {
  const cr = await prisma.contactRequest.create({
    data: {
      proUserId: fixture.proId,
      conversationId: fixture.conversationId,
      status: 'PENDING',
      lessonRequestId: null,
    },
  });
  return cr.id;
}

beforeEach(async () => {
  fixture = await seedSMFixture();
});

afterAll(async () => {
  await cleanupFixtureData();
});

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────

async function respond(
  token: string,
  contactRequestId: string,
  response: 'ACCEPT' | 'REJECT',
) {
  const agent = request.agent(app);
  const csrf = await getCsrf(agent);
  return agent
    .post('/contact/respond')
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', csrf)
    .send({ contactRequestId, response });
}

// ─── Vote immuable ────────────────────────────────────────────────────────────

describe('POST /contact/respond — vote immuable (ALREADY_RESPONDED)', () => {
  it('ACCEPT puis REJECT → 409 ALREADY_RESPONDED', async () => {
    const id = await createPendingRequest(fixture);

    await respond(fixture.riderToken, id, 'ACCEPT').then(r => expect(r.status).toBe(200));

    const res = await respond(fixture.riderToken, id, 'REJECT');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_RESPONDED');
  });

  it('REJECT puis ACCEPT → 409 ALREADY_RESPONDED', async () => {
    const id = await createPendingRequest(fixture);

    await respond(fixture.riderToken, id, 'REJECT').then(r => expect(r.status).toBe(200));

    const res = await respond(fixture.riderToken, id, 'ACCEPT');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_RESPONDED');
  });

  it('Double ACCEPT → 409 ALREADY_RESPONDED', async () => {
    const id = await createPendingRequest(fixture);

    await respond(fixture.riderToken, id, 'ACCEPT').then(r => expect(r.status).toBe(200));

    const res = await respond(fixture.riderToken, id, 'ACCEPT');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_RESPONDED');
  });

  it('Double REJECT → 409 ALREADY_RESPONDED', async () => {
    const id = await createPendingRequest(fixture);

    await respond(fixture.riderToken, id, 'REJECT').then(r => expect(r.status).toBe(200));

    const res = await respond(fixture.riderToken, id, 'REJECT');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_RESPONDED');
  });
});

// ─── Statut terminal → 409 ────────────────────────────────────────────────────

describe('POST /contact/respond — transition depuis statut terminal (ALREADY_RESOLVED)', () => {
  it('ACCEPT après statut ACCEPTED → 409 CONTACT_REQUEST_ALREADY_RESOLVED', async () => {
    // Forcer le statut ACCEPTED en DB directement (simule un premier ACCEPT déjà traité)
    const cr = await prisma.contactRequest.create({
      data: {
        proUserId: fixture.proId,
        conversationId: fixture.conversationId,
        status: 'ACCEPTED',
        lessonRequestId: null,
      },
    });

    const res = await respond(fixture.riderToken, cr.id, 'ACCEPT');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CONTACT_REQUEST_ALREADY_RESOLVED');
    expect(res.body.status).toBe('ACCEPTED');
  });

  it('REJECT après statut REJECTED → 409 CONTACT_REQUEST_ALREADY_RESOLVED', async () => {
    const cr = await prisma.contactRequest.create({
      data: {
        proUserId: fixture.proId,
        conversationId: fixture.conversationId,
        status: 'REJECTED',
        lessonRequestId: null,
      },
    });

    const res = await respond(fixture.riderToken, cr.id, 'REJECT');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CONTACT_REQUEST_ALREADY_RESOLVED');
    expect(res.body.status).toBe('REJECTED');
  });
});

// ─── Cohérence ConversationMember ─────────────────────────────────────────────

describe('POST /contact/respond — cohérence ConversationMember', () => {
  it('après ACCEPT le pro est membre de la conversation (exactement une fois)', async () => {
    const id = await createPendingRequest(fixture);

    const res = await respond(fixture.riderToken, id, 'ACCEPT');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');

    const memberships = await prisma.conversationMember.findMany({
      where: { conversationId: fixture.conversationId, userId: fixture.proId },
    });
    expect(memberships).toHaveLength(1);

    const cr = await prisma.contactRequest.findUnique({ where: { id } });
    expect(cr?.status).toBe('ACCEPTED');
  });

  it('apres REJECT le pro reste hors de la conversation', async () => {
    const id = await createPendingRequest(fixture);

    const res = await respond(fixture.riderToken, id, 'REJECT');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');

    const membership = await prisma.conversationMember.findFirst({
      where: { conversationId: fixture.conversationId, userId: fixture.proId },
    });
    expect(membership).toBeNull();

    const cr = await prisma.contactRequest.findUnique({ where: { id } });
    expect(cr?.status).toBe('REJECTED');
  });
});

// ─── Concurrence ──────────────────────────────────────────────────────────────

describe('POST /contact/respond — race condition', () => {
  it('deux ACCEPT simultanés → [200, 409] et le pro est ajouté exactement une fois', async () => {
    const id = await createPendingRequest(fixture);

    const [resA, resB] = await Promise.all([
      respond(fixture.riderToken, id, 'ACCEPT'),
      respond(fixture.riderToken, id, 'ACCEPT'),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(409);

    // Le statut final doit être ACCEPTED (pas stuck PENDING)
    const cr = await prisma.contactRequest.findUnique({ where: { id } });
    expect(cr?.status).toBe('ACCEPTED');

    // Le pro est ajouté exactement une fois (pas de doublon)
    const memberships = await prisma.conversationMember.findMany({
      where: { conversationId: fixture.conversationId, userId: fixture.proId },
    });
    expect(memberships).toHaveLength(1);
  });
});

// ─── Autorisation ─────────────────────────────────────────────────────────────

describe('POST /contact/respond — autorisation', () => {
  it('le pro ne peut pas répondre à sa propre demande → 403', async () => {
    const id = await createPendingRequest(fixture);

    const res = await respond(fixture.proToken, id, 'ACCEPT');
    expect(res.status).toBe(403);
  });

  it('un rider hors conversation → 403', async () => {
    const id = await createPendingRequest(fixture);

    const res = await respond(fixture.outsiderToken, id, 'ACCEPT');
    expect(res.status).toBe(403);
  });

  it('contactRequestId inexistant → 404', async () => {
    const res = await respond(fixture.riderToken, '00000000-0000-0000-0000-000000000000', 'ACCEPT');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Contact request not found');
  });
});

// ─── Validation stricte du body (C18.1) ──────────────────────────────────────

describe('POST /contact/respond — strict schema (champs inconnus rejetés)', () => {
  it('body avec champ inconnu → 400', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent
      .post('/contact/respond')
      .set('Authorization', `Bearer ${fixture.riderToken}`)
      .set('X-CSRF-Token', csrf)
      .send({
        contactRequestId: '00000000-0000-0000-0000-000000000000',
        response: 'ACCEPT',
        extraField: 'should-be-rejected',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid input');
  });
});
