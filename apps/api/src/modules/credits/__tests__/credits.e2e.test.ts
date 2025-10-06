import request, { SuperAgentTest } from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma } from '@blobinfini/database';
import { createApp } from '../../../index';

type Role = 'RIDER' | 'PRO' | 'ADMIN';

const app = createApp();

const emails = {
  user: 'credits-user@test.com',
  admin: 'credits-admin@test.com'
};

let userId = '';
let adminId = '';
let userToken = '';
let adminToken = '';

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
  await prisma.creditTransaction.deleteMany({
    where: { user: { email: { in: Object.values(emails) } } }
  });
  await prisma.userWallet.deleteMany({ where: { user: { email: { in: Object.values(emails) } } } });
  await prisma.adminProfile.deleteMany({ where: { user: { email: emails.admin } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
}

describe('Credits Controller', () => {
  beforeAll(async () => {
    ensureSecrets();
    await cleanupFixtureData();

    const user = await prisma.user.create({
      data: {
        email: emails.user,
        password: 'hash',
        role: 'RIDER',
        emailVerified: true
      }
    });
    userId = user.id;

    const admin = await prisma.user.create({
      data: {
        email: emails.admin,
        password: 'hash',
        role: 'ADMIN',
        emailVerified: true
      }
    });
    adminId = admin.id;
    await prisma.adminProfile.create({
      data: {
        userId: admin.id,
        displayName: 'Credits Admin'
      }
    });

    userToken = signToken(user.id, 'RIDER');
    adminToken = signToken(admin.id, 'ADMIN');
  });

  afterAll(async () => {
    await cleanupFixtureData();
  });

  it('returns an empty wallet and creates it on demand', async () => {
    const res = await request(app)
      .get('/credits/wallet')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(res.body.wallet.balance).toBe(0);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBe(0);
  });

  it('grants welcome bonus once and prevents duplicates', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);

    const bonus = await agent
      .post('/credits/welcome-bonus')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(201);

    expect(bonus.body.wallet.balance).toBe(100);
    expect(bonus.body.transaction.type).toBe('WELCOME_BONUS');

    await agent
      .post('/credits/welcome-bonus')
      .set('Authorization', `Bearer ${userToken}`)
      .set('X-CSRF-Token', csrf)
      .send({})
      .expect(400);
  });

  it('allows admins to grant credits to a user', async () => {
    const adminAgent = request.agent(app);
    const csrf = await getCsrf(adminAgent);

    const grant = await adminAgent
      .post(`/credits/admin/grant/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrf)
      .send({ amount: 45, description: 'Gest commercial' })
      .expect(201);

    expect(grant.body.wallet.balance).toBe(145);
    expect(grant.body.transaction.type).toBe('ADMIN_GRANT');
  });

  it('checks wallet balance when spending credits', async () => {
    const canSpend = await request(app)
      .get('/credits/can-spend/120')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(canSpend.body.canSpend).toBe(true);
    expect(canSpend.body.currentBalance).toBeGreaterThanOrEqual(145);

    const cannotSpend = await request(app)
      .get('/credits/can-spend/200')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(cannotSpend.body.canSpend).toBe(false);
  });

  it('lists credit transactions with pagination metadata', async () => {
    const res = await request(app)
      .get('/credits/transactions?page=1&limit=10')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toMatchObject({ page: 1, totalPages: expect.any(Number) });
  });
});
