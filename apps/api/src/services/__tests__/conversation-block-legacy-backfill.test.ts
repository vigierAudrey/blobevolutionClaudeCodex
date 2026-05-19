import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createUser } from '../../tests/helpers/prismaFactories';
import { runConversationBlockLegacyBackfill } from '../../../../../scripts/backfill-conversation-block-events';
import { CONVERSATION_BLOCK_LEGACY_BATCH_ID } from '../../modules/admin/moderation-history.constants';

const TEST_TAG = 'legacy-backfill';

async function cleanup() {
  await prisma.conversationBlockEvent.deleteMany({
    where: {
      OR: [
        { user: { email: { contains: TEST_TAG } } },
        { batchId: CONVERSATION_BLOCK_LEGACY_BATCH_ID },
      ],
    },
  });
  await prisma.conversationMember.deleteMany({
    where: { user: { email: { contains: TEST_TAG } } },
  });
  await prisma.conversation.deleteMany({
    where: { members: { none: {} } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: TEST_TAG } },
  });
}

describe('Conversation block legacy backfill', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('backfills active legacy blocks once and remains idempotent', async () => {
    const userA = await createUser(prisma, {
      email: `${TEST_TAG}-a@test.local`,
      role: Role.RIDER,
      emailVerified: true,
    });
    const userB = await createUser(prisma, {
      email: `${TEST_TAG}-b@test.local`,
      role: Role.RIDER,
      emailVerified: true,
    });

    await prisma.conversation.create({
      data: {
        type: 'RIDER_TO_RIDER',
        members: {
          create: [
            { userId: userA.id, blockedAt: new Date('2026-01-01T10:00:00.000Z') },
            { userId: userB.id, blockedAt: new Date('2026-01-02T10:00:00.000Z') },
          ],
        },
      },
    });

    const first = await runConversationBlockLegacyBackfill();
    const second = await runConversationBlockLegacyBackfill();

    const events = await prisma.conversationBlockEvent.findMany({
      where: { batchId: CONVERSATION_BLOCK_LEGACY_BATCH_ID },
      orderBy: { createdAt: 'asc' },
    });

    expect(first.inserted).toBe(2);
    expect(first.alreadyBackfilled).toBe(false);
    expect(second.inserted).toBe(0);
    expect(second.alreadyBackfilled).toBe(true);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.source === 'LEGACY_UNKNOWN')).toBe(true);
    expect(events.every((event) => event.actorType === 'SYSTEM')).toBe(true);
  });
});
