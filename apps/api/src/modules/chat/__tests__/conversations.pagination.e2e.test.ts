import { randomUUID } from 'crypto';
import { clientPrisma as prisma, Level, Role, Sport } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const app = createApp();
const ACTIVE_LAT = 50.1234;
const ACTIVE_LNG = 1.2345;

async function createRiderProfile(userId: string, displayName: string, lat: number, lng: number) {
  const profile = await prisma.riderProfile.upsert({
    where: { userId },
    update: {
      displayName,
      lat,
      lng,
      maxDistanceKm: 10,
    },
    create: {
      userId,
      displayName,
      lat,
      lng,
      maxDistanceKm: 10,
    },
  });

  await prisma.riderDiscipline.createMany({
    data: [{ profileId: profile.id, sport: Sport.surf, level: Level.advanced }],
    skipDuplicates: true,
  });
}

type ConversationListItem = {
  id: string;
};

type ConversationListResponse = {
  items: ConversationListItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

describe('Conversations pagination', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('paginates GET /conversations with a stable cursor', async () => {
    await resetDb();

    const owner = await getAccessToken({
      app,
      email: 'pagination-owner@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await createRiderProfile(owner.userId, 'Pagination Owner', ACTIVE_LAT, ACTIVE_LNG);

    const targetIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const target = await getAccessToken({
        app,
        email: `pagination-target-${index}@test.com`,
        role: Role.RIDER,
        emailVerified: true,
      });
      await createRiderProfile(target.userId, `Pagination Target ${index}`, ACTIVE_LAT + 0.001 * (index + 1), ACTIVE_LNG);

      const conversation = await prisma.conversation.create({
        data: {
          id: randomUUID(),
          type: 'RIDER_TO_RIDER',
          members: {
            create: [
              { userId: owner.userId },
              { userId: target.userId },
            ],
          },
        },
        select: { id: true },
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(Date.now() + index * 1000) },
      });

      targetIds.push(conversation.id);
    }

    const firstPage = await owner.session
      .get('/conversations?limit=2')
      .expect(200);

    const firstPayload = firstPage.body as ConversationListResponse;
    expect(firstPayload.items).toHaveLength(2);
    expect(firstPayload.hasMore).toBe(true);
    expect(typeof firstPayload.nextCursor).toBe('string');

    const secondPage = await owner.session
      .get(`/conversations?limit=2&cursor=${encodeURIComponent(firstPayload.nextCursor as string)}`)
      .expect(200);

    const secondPayload = secondPage.body as ConversationListResponse;
    expect(secondPayload.items).toHaveLength(1);
    expect(secondPayload.hasMore).toBe(false);
    expect(secondPayload.nextCursor).toBeNull();

    const seenIds = new Set([
      ...firstPayload.items.map((item) => item.id),
      ...secondPayload.items.map((item) => item.id),
    ]);

    expect(seenIds.size).toBe(3);
    expect(targetIds.every((conversationId) => seenIds.has(conversationId))).toBe(true);
  });

  it('rejects an invalid conversation cursor', async () => {
    await resetDb();

    const owner = await getAccessToken({
      app,
      email: 'pagination-invalid@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await owner.session
      .get('/conversations?cursor=not-a-real-cursor')
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe('Invalid cursor');
      });
  });
});
