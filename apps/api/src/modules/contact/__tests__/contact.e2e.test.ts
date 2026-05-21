import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { cleanupTestUsers, createTestUser } from '../../../test-utils';
import { makeLessonRequestId } from '../../../services/lesson-fanout.repository';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const emails = {
  pro: 'contact-pro@test.com',
  proB: 'contact-prob@test.com',
  riderOne: 'contact-rider1@test.com',
  riderTwo: 'contact-rider2@test.com',
};

// ─── Fixture ──────────────────────────────────────────────────────────────────
//
// matchLesson  :  pro ↔ riderOne (wantsLesson=true)
//   conversationId        — le pro EST dans ce match ; ContactRequest autorisé
//
// matchNoLesson :  pro ↔ riderTwo (wantsLesson=false)
//   noLessonConversationId — aucun rider ne veut de cours → 400
//
// matchRiderOnly :  riderOne ↔ riderTwo  (RIDER_TO_RIDER, pas de pro)
//   riderOnlyConversationId — le pro n'est PAS dans ce match → IDOR guard → 404
//
// proB : pro jamais dans aucun des matchs ci-dessus → test IDOR additionnel

type ContactFixture = {
  proId: string;
  proBId: string;
  riderOneId: string;
  riderTwoId: string;
  proToken: string;
  proBToken: string;
  riderOneToken: string;
  riderTwoToken: string;
  // conversationId : match pro + riderOne  (cas nominal)
  conversationId: string;
  // noLessonConversationId : match pro + riderTwo  (aucun rider wantsLesson)
  noLessonConversationId: string;
  // riderOnlyConversationId : match riderOne + riderTwo  (pro absent du match)
  riderOnlyConversationId: string;
};

let fixture: ContactFixture;

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

describe('Contact Controller', () => {
  const seedContactFixture = async (): Promise<ContactFixture> => {
    ensureSecrets();
    await cleanupFixtureData();

    // ── Utilisateurs ─────────────────────────────────────────────────────────

    const pro = await createTestUser({
      email: emails.pro, password: 'hash', role: 'PRO', emailVerified: true,
    });
    await prisma.proProfile.create({ data: { userId: pro.id, businessName: 'Blob Pro' } });

    const proB = await createTestUser({
      email: emails.proB, password: 'hash', role: 'PRO', emailVerified: true,
    });
    await prisma.proProfile.create({ data: { userId: proB.id, businessName: 'Blob Pro B' } });

    const riderOne = await createTestUser({
      email: emails.riderOne, password: 'hash', role: 'RIDER', emailVerified: true,
    });
    await prisma.riderProfile.create({
      data: { userId: riderOne.id, displayName: 'Rider One', wantsLesson: true },
    });

    const riderTwo = await createTestUser({
      email: emails.riderTwo, password: 'hash', role: 'RIDER', emailVerified: true,
    });
    await prisma.riderProfile.create({
      data: { userId: riderTwo.id, displayName: 'Rider Two', wantsLesson: false },
    });

    // ── Match A : pro ↔ riderOne  (cas nominal — lesson) ────────────────────
    // Le pro est dans ce match → ContactRequest autorisé.
    // Seul riderOne est membre initial ; le pro rejoint après accept.
    const matchLesson = await prisma.match.create({
      data: { userOneId: pro.id, userTwoId: riderOne.id },
    });
    const conversationLesson = await prisma.conversation.create({
      data: { matchId: matchLesson.id, type: 'RIDER_TO_RIDER' },
    });
    await prisma.conversationMember.create({
      data: { conversationId: conversationLesson.id, userId: riderOne.id },
    });

    // ── Match B : pro ↔ riderTwo  (pas de cours) ─────────────────────────────
    const matchNoLesson = await prisma.match.create({
      data: { userOneId: pro.id, userTwoId: riderTwo.id },
    });
    const conversationNoLesson = await prisma.conversation.create({
      data: { matchId: matchNoLesson.id, type: 'RIDER_TO_RIDER' },
    });
    await prisma.conversationMember.create({
      data: { conversationId: conversationNoLesson.id, userId: riderTwo.id },
    });

    // ── Match C : riderOne ↔ riderTwo  (RIDER_TO_RIDER, pro absent) ──────────
    // Le pro n'est pas dans ce match → IDOR guard doit le bloquer.
    const matchRiderOnly = await prisma.match.create({
      data: { userOneId: riderOne.id, userTwoId: riderTwo.id },
    });
    const conversationRiderOnly = await prisma.conversation.create({
      data: { matchId: matchRiderOnly.id, type: 'RIDER_TO_RIDER' },
    });
    await prisma.conversationMember.createMany({
      data: [
        { conversationId: conversationRiderOnly.id, userId: riderOne.id },
        { conversationId: conversationRiderOnly.id, userId: riderTwo.id },
      ],
    });

    return {
      proId: pro.id,
      proBId: proB.id,
      riderOneId: riderOne.id,
      riderTwoId: riderTwo.id,
      proToken: signToken(pro.id, 'PRO'),
      proBToken: signToken(proB.id, 'PRO'),
      riderOneToken: signToken(riderOne.id, 'RIDER'),
      riderTwoToken: signToken(riderTwo.id, 'RIDER'),
      conversationId: conversationLesson.id,
      noLessonConversationId: conversationNoLesson.id,
      riderOnlyConversationId: conversationRiderOnly.id,
    };
  };

  beforeEach(async () => {
    fixture = await seedContactFixture();
  });

  afterAll(async () => {
    await cleanupFixtureData();
  });

  // ─── Tests nominaux ───────────────────────────────────────────────────────

  it('allows a pro (in match) to create a contact request and exposes it to the rider', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId, message: 'On se rencontre ?' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.contactRequest).toBeDefined();
    const contactRequestId = res.body.contactRequest.id;

    const stored = await prisma.contactRequest.findUnique({ where: { id: contactRequestId } });
    expect(stored?.status).toBe('PENDING');

    const riderPending = await request(app)
      .get('/contact/pending')
      .set('Authorization', `Bearer ${fixture.riderOneToken}`)
      .expect(200);
    const pendingEntry = riderPending.body.requests.find((r: any) => r.id === contactRequestId);
    expect(pendingEntry).toBeTruthy();
  });

  it('rejects non professionals when creating contact requests', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.riderOneToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(403);
  });

  it('finalizes the request when the rider accepts', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const creation = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId, message: 'Bonjour !' })
      .expect(200);
    const contactRequestId = creation.body.contactRequest.id as string;

    const riderAgent = request.agent(app);
    const riderCsrf = await getCsrf(riderAgent);

    // Un seul rider dans la conversation → ACCEPTED dès la première réponse
    const response = await riderAgent
      .post('/contact/respond')
      .set('Authorization', `Bearer ${fixture.riderOneToken}`)
      .set('X-CSRF-Token', riderCsrf)
      .send({ contactRequestId, response: 'ACCEPT' })
      .expect(200);

    expect(response.body.status).toBe('ACCEPTED');

    const finalStatus = await prisma.contactRequest.findUnique({ where: { id: contactRequestId } });
    expect(finalStatus?.status).toBe('ACCEPTED');

    // Le pro doit être ajouté en tant que ConversationMember après acceptance
    const proMembership = await prisma.conversationMember.findFirst({
      where: { conversationId: fixture.conversationId, userId: fixture.proId },
    });
    expect(proMembership).toBeTruthy();

    const proView = await request(app)
      .get('/contact/requests')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .expect(200);
    const recorded = proView.body.requests.find((r: any) => r.id === contactRequestId);
    expect(recorded?.status).toBe('ACCEPTED');
  });

  // ─── Sprint C1 — attribution lessonRequestId ─────────────────────────────

  it('stores lessonRequestId on ContactRequest when a rider has wantsLesson=true', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(200);

    const stored = await prisma.contactRequest.findUnique({
      where: { id: res.body.contactRequest.id },
    });
    expect(stored?.lessonRequestId).not.toBeNull();
    expect(typeof stored?.lessonRequestId).toBe('string');
    expect(stored!.lessonRequestId!.length).toBe(16);
  });

  it('stores the exact lessonRequestId derived from makeLessonRequestId(riderId)', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(200);

    const stored = await prisma.contactRequest.findUnique({
      where: { id: res.body.contactRequest.id },
    });
    // riderOne est le participant avec wantsLesson=true
    const expected = makeLessonRequestId(fixture.riderOneId);
    expect(stored?.lessonRequestId).toBe(expected);
  });

  it('ignores lessonRequestId sent by the client — strict schema rejects unknown keys', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId, lessonRequestId: 'clientcontrolled00' })
      .expect(400);

    expect(res.body.error).toBe('Invalid input');
  });

  it('rejects ContactRequest when no rider in the match has wantsLesson=true', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.noLessonConversationId })
      .expect(400);
  });

  // ─── IDOR guard ───────────────────────────────────────────────────────────

  it('returns 404 when the pro is not a participant in the conversation match', async () => {
    // proB n'est dans aucun match : il ne peut accéder à aucune conversation valide
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proBToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId })
      .expect(404);

    // Message neutre — identique à "conversation not found" pour éviter l'énumération
    expect(res.body.error).toBe('Conversation or match not found');
  });

  it('returns 404 when pro targets a RIDER_TO_RIDER conversation where they have no match', async () => {
    // pro essaie d'accéder à une conversation riderOne↔riderTwo où il n'est pas dans le match
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.riderOnlyConversationId })
      .expect(404);

    expect(res.body.error).toBe('Conversation or match not found');
  });

  it('returns 404 for an unknown conversationId (no information leak)', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);

    expect(res.body.error).toBe('Conversation or match not found');
  });

  // ─── Rétro-compatibilité ──────────────────────────────────────────────────

  it('backward compat: ContactRequest with null lessonRequestId is fully readable', async () => {
    // Simule une ContactRequest antérieure au sprint C1 (lessonRequestId absent)
    const legacy = await prisma.contactRequest.create({
      data: {
        proUserId: fixture.proId,
        conversationId: fixture.conversationId,
        status: 'PENDING',
        lessonRequestId: null,
      },
    });

    const stored = await prisma.contactRequest.findUnique({ where: { id: legacy.id } });
    expect(stored).not.toBeNull();
    expect(stored?.lessonRequestId).toBeNull();
    expect(stored?.status).toBe('PENDING');

    await prisma.contactRequest.delete({ where: { id: legacy.id } });
  });
});
