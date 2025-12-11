import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const emails = {
  reporter: 'reports-reporter@test.com',
  target: 'reports-target@test.com'
};

let reporterToken = '';
let targetProfileId = '';

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
  await prisma.profileReport.deleteMany({
    where: {
      OR: [
        { reporter: { email: emails.reporter } },
        { reportedProfile: { user: { email: emails.target } } }
      ]
    }
  });
  await prisma.riderProfile.deleteMany({ where: { user: { email: { in: Object.values(emails) } } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
}

async function setupReporterAndTarget() {
  const reporter = await prisma.user.create({
    data: {
      email: emails.reporter,
      password: 'hash',
      role: 'RIDER',
      emailVerified: true
    }
  });
  await prisma.riderProfile.create({
    data: {
      userId: reporter.id,
      displayName: 'Reporter'
    }
  });

  const target = await prisma.user.create({
    data: {
      email: emails.target,
      password: 'hash',
      role: 'RIDER',
      emailVerified: true
    }
  });
  const targetProfile = await prisma.riderProfile.create({
    data: {
      userId: target.id,
      displayName: 'Target'
    }
  });

  return { reporterId: reporter.id, targetProfileId: targetProfile.id };
}

describe('Reports Controller', () => {
  beforeAll(() => {
    ensureSecrets();
  });

  beforeEach(async () => {
    await cleanupFixtureData();
    const { reporterId, targetProfileId: createdTargetProfileId } = await setupReporterAndTarget();
    reporterToken = signToken(reporterId, 'RIDER');
    targetProfileId = createdTargetProfileId;
  });

  afterAll(async () => {
    await cleanupFixtureData();
  });

  it('creates a profile report when payload is valid', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/reports/profile')
      .set('Authorization', `Bearer ${reporterToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ targetProfileId, reason: 'Comportement inapproprié' })
      .expect(201);

    expect(res.body).toMatchObject({ ok: true });
    const created = await prisma.profileReport.findUnique({ where: { id: res.body.id } });
    expect(created).toBeTruthy();
    expect(created?.reportedProfileId).toBe(targetProfileId);
  });

  it('rejects invalid payloads', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const res = await agent
      .post('/reports/profile')
      .set('Authorization', `Bearer ${reporterToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ targetProfileId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    await agent
      .post('/reports/profile')
      .set('X-CSRF-Token', csrf)
      .send({ targetProfileId })
      .expect(401);
  });
});
