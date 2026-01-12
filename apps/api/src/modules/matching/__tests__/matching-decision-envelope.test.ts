import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, getOrCreateUserByEmail, TestSession } from '../../../tests/helpers/auth';
import * as logger from '../../../utils/secure-logger';

const app = createApp();

describe('POST /matching/decision (envelope opt-in)', () => {
  let session: TestSession;
  let accessToken = '';
  let actorUserId = '';
  let targetProfileId = '';

  const resetDb = async () => {
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.matchDecision.deleteMany();
    await prisma.match.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: {
          in: ['actor-envelope@test.com', 'target-envelope@test.com'],
        },
      },
    });
  };

  const seedActors = async () => {
    const actorAuth = await getAccessToken({
      app,
      email: 'actor-envelope@test.com',
      role: Role.RIDER,
    });
    session = actorAuth.session;
    accessToken = actorAuth.accessToken;
    actorUserId = actorAuth.userId;

    await prisma.riderProfile.upsert({
      where: { userId: actorUserId },
      create: { userId: actorUserId, displayName: 'Actor Rider' },
      update: { displayName: 'Actor Rider' },
    });

    const targetUser = await getOrCreateUserByEmail({
      email: 'target-envelope@test.com',
      role: Role.RIDER,
    });
    const targetProfile = await prisma.riderProfile.upsert({
      where: { userId: targetUser.id },
      create: { userId: targetUser.id, displayName: 'Target Rider' },
      update: { displayName: 'Target Rider' },
    });
    targetProfileId = targetProfile.id;
  };

  beforeEach(async () => {
    await resetDb();
    await seedActors();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const buildPayload = () => ({ targetProfileId, decision: 'ACCEPT' as const });

  it('returns VALIDATION_ERROR with envelope when payload is invalid', async () => {
    const res = await session
      .post('/matching/decision')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send({})
      .expect(400);

    expect(res.body).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('creates a decision with envelope response when payload is valid', async () => {
    const spy = jest.spyOn(logger.secureLogger, 'info').mockImplementation(() => {});

    const res = await session
      .post('/matching/decision')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send(buildPayload())
      .expect(200);

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2026-04-12T00:00:00Z');
    expect(res.headers['link']).toContain('/matching/decisions');
    expect(spy).toHaveBeenCalledWith('deprecated_endpoint_used', expect.objectContaining({ endpoint: '/matching/decision', mode: 'enveloped', count: expect.any(Number) }));
    expect(res.body).toMatchObject({
      ok: true,
      data: {
        createdConversations: expect.any(Array),
      },
    });
    expect(res.body.error).toBeUndefined();
  });

  it('returns MATCHING_CONFLICT on duplicate decision with envelope', async () => {
    await session
      .post('/matching/decision')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send(buildPayload())
      .expect(200);

    const conflict = await session
      .post('/matching/decision')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-API-ENVELOPE', '1')
      .send(buildPayload())
      .expect(409);

    expect(conflict.body).toMatchObject({
      ok: false,
      error: { code: 'MATCHING_CONFLICT' },
    });
  });

  it('keeps legacy response unchanged when header is missing', async () => {
    const spy = jest.spyOn(logger.secureLogger, 'info').mockImplementation(() => {});

    const res = await session
      .post('/matching/decision')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(buildPayload())
      .expect(200);

    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBe('2026-04-12T00:00:00Z');
    expect(res.headers['link']).toContain('/matching/decisions');
    expect(spy).toHaveBeenCalledWith('deprecated_endpoint_used', expect.objectContaining({ endpoint: '/matching/decision', mode: 'legacy', count: expect.any(Number) }));
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toBeUndefined();
    expect(res.body.error).toBeUndefined();
    expect(Array.isArray(res.body.createdConversations)).toBe(true);
  });
});
