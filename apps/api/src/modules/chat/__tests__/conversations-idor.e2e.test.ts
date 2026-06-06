import { randomUUID } from 'crypto';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken, type TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const app = createApp();

type UserCtx = {
  session: TestSession;
  userId: string;
};

async function createAuthedRider(email: string): Promise<UserCtx> {
  const auth = await getAccessToken({ app, email, role: Role.RIDER, emailVerified: true });
  await prisma.riderProfile.upsert({
    where: { userId: auth.userId },
    create: { userId: auth.userId, displayName: email.split('@')[0] },
    update: { displayName: email.split('@')[0] },
  });
  return { session: auth.session, userId: auth.userId };
}

async function createConversation(ownerId: string, peerId: string) {
  return prisma.conversation.create({
    data: {
      id: randomUUID(),
      type: 'RIDER_TO_RIDER',
      members: {
        createMany: {
          data: [
            { userId: ownerId },
            { userId: peerId },
          ],
        },
      },
      messages: {
        create: {
          senderId: ownerId,
          type: 'TEXT',
          content: 'message privé',
        },
      },
    },
    select: { id: true },
  });
}

describe('Conversations HTTP — IDOR guards', () => {
  let owner: UserCtx;
  let peer: UserCtx;
  let intruder: UserCtx;
  let conversationId: string;

  beforeEach(async () => {
    await resetDb();
    const stamp = Date.now();
    owner = await createAuthedRider(`chat-idor-owner-${stamp}@test.local`);
    peer = await createAuthedRider(`chat-idor-peer-${stamp}@test.local`);
    intruder = await createAuthedRider(`chat-idor-intruder-${stamp}@test.local`);
    const conversation = await createConversation(owner.userId, peer.userId);
    conversationId = conversation.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('refuse la lecture des messages à un utilisateur non membre', async () => {
    await intruder.session
      .get(`/conversations/${conversationId}/messages`)
      .expect(404);
  });

  it('refuse l’envoi de message à un utilisateur non membre', async () => {
    await intruder.session
      .post(`/conversations/${conversationId}/messages`)
      .send({ type: 'TEXT', content: 'intrusion' })
      .expect(404);

    const count = await prisma.message.count({
      where: { conversationId, content: 'intrusion' },
    });
    expect(count).toBe(0);
  });

  it('refuse la liste des membres à un utilisateur non membre', async () => {
    await intruder.session
      .get(`/conversations/${conversationId}/members`)
      .expect(404);
  });

  it('retourne 400 sur limite messages invalide sans erreur technique', async () => {
    await owner.session
      .get(`/conversations/${conversationId}/messages?limit=0`)
      .expect(400);

    await owner.session
      .get(`/conversations/${conversationId}/messages?limit=101`)
      .expect(400);
  });

  it('ne permet pas à un utilisateur non invité de répondre à une invitation', async () => {
    const invitation = await prisma.conversationInvitation.create({
      data: {
        conversationId,
        invitedBy: owner.userId,
        invitedUserId: peer.userId,
        status: 'PENDING',
      },
      select: { id: true },
    });

    await intruder.session
      .post(`/conversations/invitations/${invitation.id}/respond`)
      .send({ action: 'ACCEPT' })
      .expect(404);

    const stored = await prisma.conversationInvitation.findUnique({
      where: { id: invitation.id },
      select: { status: true },
    });
    expect(stored?.status).toBe('PENDING');

    const intruderMember = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: intruder.userId,
        },
      },
    });
    expect(intruderMember).toBeNull();
  });
});
