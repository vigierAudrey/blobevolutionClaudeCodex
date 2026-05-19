import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createUser } from '../../tests/helpers/prismaFactories';
import {
  conversationBlockEventService,
  ConversationBlockEventServiceError,
  DEFAULT_BULK_MAX_SYNC,
} from '../conversation-block-event.service';

const TEST_TAG = 'cbe-service';

async function cleanup() {
  await prisma.conversationBlockEvent.deleteMany({
    where: {
      OR: [
        { user: { email: { contains: TEST_TAG } } },
        { actorUser: { email: { contains: TEST_TAG } } },
      ],
    },
  });
  await prisma.conversationMember.deleteMany({
    where: {
      user: { email: { contains: TEST_TAG } },
    },
  });
  await prisma.conversation.deleteMany({
    where: {
      members: { none: {} },
    },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: TEST_TAG } },
  });
}

async function seedConversation(memberCount = 2) {
  const admin = await createUser(prisma, {
    email: `${TEST_TAG}-admin-${Date.now()}@test.local`,
    role: Role.ADMIN,
    emailVerified: true,
  });

  const members = await Promise.all(
    Array.from({ length: memberCount }, async (_, index) => createUser(prisma, {
      email: `${TEST_TAG}-member-${Date.now()}-${index}@test.local`,
      role: Role.RIDER,
      emailVerified: true,
    })),
  );

  const conversation = await prisma.conversation.create({
    data: {
      type: 'RIDER_TO_RIDER',
      members: {
        create: members.map((member) => ({
          userId: member.id,
          blockedAt: new Date(),
        })),
      },
    },
  });

  return { admin, members, conversation };
}

describe('ConversationBlockEventService', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('writes business events and updates current block state atomically', async () => {
    const { admin, members, conversation } = await seedConversation();

    const result = await conversationBlockEventService.setConversationBlock({
      conversationId: conversation.id,
      targetUserIds: [members[0].id],
      action: 'unblock',
      actorUserId: admin.id,
      actorType: 'ADMIN',
      source: 'ADMIN_SINGLE',
      reason: 'Support review',
    });

    expect(result.updatedMembers).toHaveLength(1);
    expect(result.updatedMembers[0]?.blockedAt).toBeNull();

    const event = await prisma.conversationBlockEvent.findFirst({
      where: {
        conversationId: conversation.id,
        userId: members[0].id,
      },
      orderBy: { createdAt: 'desc' },
    });

    const member = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: members[0].id,
        },
      },
    });

    expect(event).toMatchObject({
      actorUserId: admin.id,
      action: 'UNBLOCK',
      source: 'ADMIN_SINGLE',
      reason: 'Support review',
    });
    expect(member?.blockedAt).toBeNull();
  });

  it('rejects synchronous bulk unblock above the safe cap', async () => {
    const admin = await createUser(prisma, {
      email: `${TEST_TAG}-bulk-admin-${Date.now()}@test.local`,
      role: Role.ADMIN,
      emailVerified: true,
    });

    const countSpy = jest.spyOn(prisma.conversationMember, 'count').mockResolvedValue(DEFAULT_BULK_MAX_SYNC + 1);
    try {
      await expect(
        conversationBlockEventService.unblockAllConversationMembers(admin.id),
      ).rejects.toMatchObject<Partial<ConversationBlockEventServiceError>>({
        code: 'BULK_TOO_LARGE',
      });
    } finally {
      countSpy.mockRestore();
    }
  });
});
