import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { cleanupTestUsers, createTestUser } from '../../../test-utils';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const emails = {
  pro: 'contact-pro@test.com',
  riderOne: 'contact-rider1@test.com',
  riderTwo: 'contact-rider2@test.com'
};

type ContactFixture = {
  proId: string;
  riderOneId: string;
  riderTwoId: string;
  proToken: string;
  riderOneToken: string;
  riderTwoToken: string;
  conversationId: string;
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

    const pro = await createTestUser({
      email: emails.pro,
      password: 'hash',
      role: 'PRO',
      emailVerified: true
    });
    await prisma.proProfile.create({
      data: {
        userId: pro.id,
        businessName: 'Blob Pro'
      }
    });

    const riderOne = await createTestUser({
      email: emails.riderOne,
      password: 'hash',
      role: 'RIDER',
      emailVerified: true
    });
    await prisma.riderProfile.create({
      data: {
        userId: riderOne.id,
        displayName: 'Rider One',
        wantsLesson: true
      }
    });

    const riderTwo = await createTestUser({
      email: emails.riderTwo,
      password: 'hash',
      role: 'RIDER',
      emailVerified: true
    });
    await prisma.riderProfile.create({
      data: {
        userId: riderTwo.id,
        displayName: 'Rider Two',
        wantsLesson: false
      }
    });

    const match = await prisma.match.create({
      data: {
        userOneId: riderOne.id,
        userTwoId: riderTwo.id
      }
    });

    const conversation = await prisma.conversation.create({
      data: {
        matchId: match.id,
        type: 'RIDER_TO_RIDER'
      }
    });

    await prisma.conversationMember.createMany({
      data: [
        { conversationId: conversation.id, userId: riderOne.id },
        { conversationId: conversation.id, userId: riderTwo.id }
      ]
    });

    return {
      proId: pro.id,
      riderOneId: riderOne.id,
      riderTwoId: riderTwo.id,
      proToken: signToken(pro.id, 'PRO'),
      riderOneToken: signToken(riderOne.id, 'RIDER'),
      riderTwoToken: signToken(riderTwo.id, 'RIDER'),
      conversationId: conversation.id
    };
  };

  beforeEach(async () => {
    fixture = await seedContactFixture();
  });

  afterAll(async () => {
    await cleanupFixtureData();
  });

  it('allows a pro to create a contact request and exposes it to riders', async () => {
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
    const pendingEntry = riderPending.body.requests.find((req: any) => req.id === contactRequestId);
    expect(pendingEntry).toBeTruthy();
  });

  it('rejects non professionals when creating contact requests', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.riderOneToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId, message: 'Je tente ma chance' })
      .expect(403);
  });

  it('collects rider responses and finalizes the request when all accept', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const creation = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId: fixture.conversationId, message: 'On se rencontre ?' })
      .expect(200);
    const contactRequestId = creation.body.contactRequest.id as string;

    const riderAgent = request.agent(app);
    const riderCsrf = await getCsrf(riderAgent);

    const firstResponse = await riderAgent
      .post('/contact/respond')
      .set('Authorization', `Bearer ${fixture.riderOneToken}`)
      .set('X-CSRF-Token', riderCsrf)
      .send({ contactRequestId, response: 'ACCEPT' })
      .expect(200);

    expect(firstResponse.body.status).toBe('PENDING');
    const stillPending = await prisma.contactRequest.findUnique({ where: { id: contactRequestId } });
    expect(stillPending?.status).toBe('PENDING');

    const riderTwoAgent = request.agent(app);
    const riderTwoCsrf = await getCsrf(riderTwoAgent);

    const secondResponse = await riderTwoAgent
      .post('/contact/respond')
      .set('Authorization', `Bearer ${fixture.riderTwoToken}`)
      .set('X-CSRF-Token', riderTwoCsrf)
      .send({ contactRequestId, response: 'ACCEPT' })
      .expect(200);

    expect(secondResponse.body.status).toBe('ACCEPTED');

    const finalStatus = await prisma.contactRequest.findUnique({ where: { id: contactRequestId } });
    expect(finalStatus?.status).toBe('ACCEPTED');

    const proMembership = await prisma.conversationMember.findFirst({
      where: { conversationId: fixture.conversationId, userId: fixture.proId }
    });
    expect(proMembership).toBeTruthy();

    const proView = await request(app)
      .get('/contact/requests')
      .set('Authorization', `Bearer ${fixture.proToken}`)
      .expect(200);
    const recorded = proView.body.requests.find((req: any) => req.id === contactRequestId);
    expect(recorded?.status).toBe('ACCEPTED');
  });
});
