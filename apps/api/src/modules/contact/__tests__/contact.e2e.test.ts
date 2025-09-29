import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const emails = {
  pro: 'contact-pro@test.com',
  riderOne: 'contact-rider1@test.com',
  riderTwo: 'contact-rider2@test.com'
};

let proId = '';
let riderOneId = '';
let riderTwoId = '';
let proToken = '';
let riderOneToken = '';
let riderTwoToken = '';
let conversationId = '';
let contactRequestId = '';

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
  await prisma.contactRequestResponse.deleteMany({
    where: {
      OR: [
        { rider: { email: { in: [emails.riderOne, emails.riderTwo] } } },
        { contactRequest: { pro: { email: emails.pro } } }
      ]
    }
  });
  await prisma.contactRequest.deleteMany({
    where: {
      pro: { email: emails.pro }
    }
  });
  await prisma.conversationMember.deleteMany({
    where: { user: { email: { in: Object.values(emails) } } }
  });
  await prisma.conversation.deleteMany({
    where: {
      members: {
        some: { user: { email: { in: Object.values(emails) } } }
      }
    }
  });
  await prisma.match.deleteMany({
    where: {
      OR: [
        { userOne: { email: { in: [emails.riderOne, emails.riderTwo] } } },
        { userTwo: { email: { in: [emails.riderOne, emails.riderTwo] } } }
      ]
    }
  });
  await prisma.proProfile.deleteMany({ where: { user: { email: emails.pro } } });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { in: [emails.riderOne, emails.riderTwo] } } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
}

describe('Contact Controller', () => {
  beforeAll(async () => {
    ensureSecrets();
    await cleanupFixtureData();

    const pro = await prisma.user.create({
      data: {
        email: emails.pro,
        password: 'hash',
        role: 'PRO',
        emailVerified: true
      }
    });
    proId = pro.id;
    await prisma.proProfile.create({
      data: {
        userId: pro.id,
        businessName: 'Blob Pro'
      }
    });

    const riderOne = await prisma.user.create({
      data: {
        email: emails.riderOne,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    riderOneId = riderOne.id;
    await prisma.riderProfile.create({
      data: {
        userId: riderOne.id,
        displayName: 'Rider One',
        wantsLesson: true
      }
    });

    const riderTwo = await prisma.user.create({
      data: {
        email: emails.riderTwo,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    riderTwoId = riderTwo.id;
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
    conversationId = conversation.id;

    await prisma.conversationMember.createMany({
      data: [
        { conversationId, userId: riderOne.id },
        { conversationId, userId: riderTwo.id }
      ]
    });

    proToken = signToken(pro.id, 'PRO');
    riderOneToken = signToken(riderOne.id, 'RIDER');
    riderTwoToken = signToken(riderTwo.id, 'RIDER');
  });

  afterAll(async () => {
    await cleanupFixtureData();
  });

  it('allows a pro to create a contact request and exposes it to riders', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${proToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId, message: 'On se rencontre ?' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.contactRequest).toBeDefined();
    contactRequestId = res.body.contactRequest.id;

    const stored = await prisma.contactRequest.findUnique({ where: { id: contactRequestId } });
    expect(stored?.status).toBe('PENDING');

    const riderPending = await request(app)
      .get('/contact/pending')
      .set('Authorization', `Bearer ${riderOneToken}`)
      .expect(200);
    const pendingEntry = riderPending.body.requests.find((req: any) => req.id === contactRequestId);
    expect(pendingEntry).toBeTruthy();
  });

  it('rejects non professionals when creating contact requests', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post('/contact/request')
      .set('Authorization', `Bearer ${riderOneToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ conversationId, message: 'Je tente ma chance' })
      .expect(403);
  });

  it('collects rider responses and finalizes the request when all accept', async () => {
    expect(contactRequestId).toBeTruthy();

    const riderAgent = request.agent(app);
    const riderCsrf = await getCsrf(riderAgent);

    const firstResponse = await riderAgent
      .post('/contact/respond')
      .set('Authorization', `Bearer ${riderOneToken}`)
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
      .set('Authorization', `Bearer ${riderTwoToken}`)
      .set('X-CSRF-Token', riderTwoCsrf)
      .send({ contactRequestId, response: 'ACCEPT' })
      .expect(200);

    expect(secondResponse.body.status).toBe('ACCEPTED');

    const finalStatus = await prisma.contactRequest.findUnique({ where: { id: contactRequestId } });
    expect(finalStatus?.status).toBe('ACCEPTED');

    const proMembership = await prisma.conversationMember.findFirst({
      where: { conversationId, userId: proId }
    });
    expect(proMembership).toBeTruthy();

    const proView = await request(app)
      .get('/contact/requests')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);
    const recorded = proView.body.requests.find((req: any) => req.id === contactRequestId);
    expect(recorded?.status).toBe('ACCEPTED');
  });
});
