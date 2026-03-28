import { clientPrisma as prisma, Prisma, Role } from '@blobinfini/database';
import { createApp } from '../../../index';
import { createTestSession, getAccessToken, TestSession } from '../../../tests/helpers/auth';

const app = createApp();

describe('Conversations open endpoint', () => {
  let riderSession: TestSession;
  let riderId = '';
  let proId = '';
  let otherRiderSession: TestSession;
  let otherRiderId = '';
  let riderMatchId = '';

  beforeEach(async () => {
    await prisma.matchDecision.deleteMany();
    await prisma.match.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.riderProfile.deleteMany();
    await prisma.proProfile.deleteMany();
    await prisma.user.deleteMany();

    const riderAuth = await getAccessToken({ app, email: 'rider-conv@test.com', role: Role.RIDER });
    riderSession = riderAuth.session;
    riderId = riderAuth.userId;

    const otherRiderAuth = await getAccessToken({ app, email: 'other-rider-conv@test.com', role: Role.RIDER });
    otherRiderSession = otherRiderAuth.session;
    otherRiderId = otherRiderAuth.userId;

    const proAuth = await getAccessToken({ app, email: 'pro-conv@test.com', role: Role.PRO });
    proId = proAuth.userId;

    await prisma.proProfile.upsert({
      where: { userId: proId },
      create: { userId: proId, lat: 43.5, lng: -1.5, verified: true },
      update: { lat: 43.5, lng: -1.5, verified: true },
    });

    await prisma.riderProfile.createMany({
      data: [
        { userId: riderId, displayName: 'Rider One' },
        { userId: otherRiderId, displayName: 'Rider Two' },
      ],
      skipDuplicates: true,
    });

    const [userOneId, userTwoId] = [riderId, otherRiderId].sort();
    const riderMatch = await prisma.match.create({
      data: { userOneId, userTwoId, status: 'ACTIVE' },
      select: { id: true },
    });
    riderMatchId = riderMatch.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('returns the same conversation id when opening twice', async () => {
    const first = await riderSession
      .post('/conversations/open')
      .send({ targetUserId: proId })
      .expect(201);

    const second = await riderSession
      .post('/conversations/open')
      .send({ targetUserId: proId })
      .expect(200);

    expect(first.body.id).toBeDefined();
    expect(second.body.id).toBe(first.body.id);

    const total = await prisma.conversation.count();
    expect(total).toBe(1);
  });

  it('applies cooldown when sending messages too quickly', async () => {
    const { body: conv } = await riderSession
      .post('/conversations/open')
      .send({ targetUserId: proId })
      .expect(201);

    const msg = await riderSession
      .post(`/conversations/${conv.id}/messages`)
      .send({ type: 'TEXT', content: 'Hello pro' })
      .expect(201);

    await riderSession
      .post('/conversations/open')
      .send({ targetUserId: proId })
      .expect(429)
      .expect((res) => {
        expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
        expect(res.body.code).toBe('CONVERSATION_COOLDOWN');
      });

    await prisma.message.update({
      where: { id: msg.body.id as string },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    await riderSession
      .post('/conversations/open')
      .send({ targetUserId: proId })
      .expect(200);
  });

  it('respects rate limit on /conversations/open', async () => {
    const prev = process.env.ENABLE_RATE_LIMIT_IN_TESTS;
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
    try {
      for (let i = 0; i < 10; i++) {
        await riderSession
          .post('/conversations/open')
          .send({ targetUserId: proId })
          .expect(i === 0 ? 201 : 200);
      }

      await riderSession
        .post('/conversations/open')
        .send({ targetUserId: proId })
        .expect(429)
        .expect((res) => {
          expect(res.body.code).toBe('RATE_LIMIT');
          expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
        });
    } finally {
      if (prev === undefined) {
        delete process.env.ENABLE_RATE_LIMIT_IN_TESTS;
      } else {
        process.env.ENABLE_RATE_LIMIT_IN_TESTS = prev;
      }
    }
  });

  it('is idempotent under concurrent calls', async () => {
    const results = await Promise.allSettled([
      riderSession.post('/conversations/open').send({ targetUserId: proId }),
      riderSession.post('/conversations/open').send({ targetUserId: proId }),
    ]);

    const ids = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value.body.id);
    expect(new Set(ids).size).toBe(1);

    const count = await prisma.conversation.count();
    expect(count).toBe(1);
  });

  it('rejects rider-to-rider opening when no active match exists', async () => {
    await prisma.match.delete({ where: { id: riderMatchId } });

    await riderSession
      .post('/conversations/open')
      .send({ targetUserId: otherRiderId })
      .expect(403);

    const total = await prisma.conversation.count();
    expect(total).toBe(0);
  });

  it('rejects self conversation opening', async () => {
    await riderSession
      .post('/conversations/open')
      .send({ targetUserId: riderId })
      .expect(400);

    const total = await prisma.conversation.count();
    expect(total).toBe(0);
  });

  it('reuses the existing match conversation for rider-to-rider opening', async () => {
    const matchConversation = await prisma.conversation.create({
      data: {
        matchId: riderMatchId,
        members: {
          create: [{ userId: riderId }, { userId: otherRiderId }],
        },
      },
      select: { id: true },
    });

    const res = await riderSession
      .post('/conversations/open')
      .send({ targetUserId: otherRiderId })
      .expect(200);

    expect(res.body.id).toBe(matchConversation.id);

    const total = await prisma.conversation.count();
    expect(total).toBe(1);
  });

  it('creates a single match-linked rider conversation under concurrent opens', async () => {
    const results = await Promise.all([
      riderSession.post('/conversations/open').send({ targetUserId: otherRiderId }),
      otherRiderSession.post('/conversations/open').send({ targetUserId: riderId }),
    ]);

    expect([results[0].status, results[1].status].sort()).toEqual([200, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);

    const conversation = await prisma.conversation.findFirst({
      where: { matchId: riderMatchId },
      select: { id: true, directKey: true, type: true },
    });
    expect(conversation?.id).toBe(results[0].body.id);
    expect(conversation?.directKey).toContain('RIDER_TO_RIDER');
    expect(conversation?.type).toBe('RIDER_TO_RIDER');

    const memberCount = await prisma.conversationMember.count({
      where: { conversationId: conversation!.id },
    });
    expect(memberCount).toBe(2);
  });

  it('rejects rider-to-rider open when unmatch commits before the transactional match lock is acquired', async () => {
    const matchConversation = await prisma.conversation.create({
      data: {
        matchId: riderMatchId,
        members: {
          create: [{ userId: riderId }, { userId: otherRiderId }],
        },
      },
      select: { id: true },
    });

    const lockReady = createDeferred<void>();
    const releaseLock = createDeferred<void>();
    const blocker = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id
        FROM "Match"
        WHERE id = ${riderMatchId}
        FOR UPDATE
      `);
      lockReady.resolve();
      await releaseLock.promise;
    });

    await lockReady.promise;

    const unmatchPromise = riderSession
      .post(`/conversations/${matchConversation.id}/unmatch`)
      .send()
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const openPromise = otherRiderSession
      .post('/conversations/open')
      .send({ targetUserId: riderId })
      .expect(403);

    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseLock.resolve();

    await Promise.all([blocker, unmatchPromise, openPromise]);

    const total = await prisma.conversation.count();
    expect(total).toBe(1);

    const match = await prisma.match.findUnique({
      where: { id: riderMatchId },
      select: { status: true },
    });
    expect(match?.status).toBe('UNMATCHED');
  });
});
