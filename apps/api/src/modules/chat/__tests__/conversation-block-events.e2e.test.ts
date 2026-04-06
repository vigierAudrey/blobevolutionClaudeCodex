import request, { SuperAgentTest } from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { ensureRiderProfile } from '../../../tests/helpers/prismaFactories';

describe('Conversation block events E2E', () => {
  const app = createApp();
  let agent: SuperAgentTest;
  let csrfToken: string;
  let riderAccessToken: string;
  let riderId: string;
  let otherRiderId: string;

  const post = (path: string) => agent.post(path).set('X-CSRF-Token', csrfToken);

  async function cleanup() {
    await prisma.conversationBlockEvent.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany({
      where: {
        email: { in: ['block-rider@test.com', 'block-rider-2@test.com'] },
      },
    });
  }

  async function resolveUserId(email: string, role: Role) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      throw new Error(`User not found after registration: ${email} (${role})`);
    }
    return existing.id;
  }

  beforeEach(async () => {
    await cleanup();
    agent = request.agent(app);
    const csrfRes = await agent.get('/csrf-token').expect(200);
    csrfToken = csrfRes.body.csrfToken as string;

    await post('/auth/register')
      .send({ email: 'block-rider@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);
    await post('/auth/register')
      .send({ email: 'block-rider-2@test.com', password: 'Passw0rd!', role: 'RIDER', consentAccepted: true })
      .expect(201);

    riderId = await resolveUserId('block-rider@test.com', Role.RIDER);
    otherRiderId = await resolveUserId('block-rider-2@test.com', Role.RIDER);

    await prisma.user.updateMany({
      where: { id: { in: [riderId, otherRiderId] } },
      data: { emailVerified: true },
    });

    const loginRes = await post('/auth/login')
      .send({ email: 'block-rider@test.com', password: 'Passw0rd!' })
      .expect(200);
    riderAccessToken = loginRes.body.accessToken as string;

    await ensureRiderProfile(prisma, {
      userId: riderId,
      profile: { displayName: 'Block Rider' },
    });
    await ensureRiderProfile(prisma, {
      userId: otherRiderId,
      profile: { displayName: 'Other Block Rider' },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('writes business events when a user blocks and unblocks a conversation', async () => {
    const openRes = await post('/conversations/open')
      .set('Authorization', `Bearer ${riderAccessToken}`)
      .send({ targetUserId: otherRiderId })
      .expect(201);

    const conversationId = openRes.body.id as string;

    await post(`/conversations/${conversationId}/block`)
      .set('Authorization', `Bearer ${riderAccessToken}`)
      .send({ action: 'block' })
      .expect(200);

    await post(`/conversations/${conversationId}/block`)
      .set('Authorization', `Bearer ${riderAccessToken}`)
      .send({ action: 'unblock' })
      .expect(200);

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: riderId } },
    });
    const events = await prisma.conversationBlockEvent.findMany({
      where: { conversationId, userId: riderId },
      orderBy: { createdAt: 'asc' },
    });

    expect(member?.blockedAt).toBeNull();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      actorUserId: riderId,
      actorType: 'USER',
      action: 'BLOCK',
      source: 'USER_SELF',
    });
    expect(events[1]).toMatchObject({
      actorUserId: riderId,
      actorType: 'USER',
      action: 'UNBLOCK',
      source: 'USER_SELF',
    });
  });
});
