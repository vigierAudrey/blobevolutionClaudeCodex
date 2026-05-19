import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { createTestSession, getAccessToken, TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';
import { secureLogger } from '../../../utils/secure-logger';

describe('POST /matching/decisions security & safety', () => {
  const app = createApp();
  const makeMissingProfileId = (n: number) => `ffffffff-ffff-4fff-8fff-${n.toString(16).padStart(12, 'f')}`;

  let riderASession: TestSession;
  let riderAUserId = '';
  let riderAProfileId = '';

  let riderBSession: TestSession;
  let riderBUserId = '';
  let riderBProfileId = '';

  let riderCUserId = '';
  let riderCProfileId = '';

  let proSession: TestSession;
  let proUserId = '';

  beforeEach(async () => {
    await resetDb();

    const riderAEmail = `matching-rider-a-${Date.now()}@test.com`;
    const riderBEmail = `matching-rider-b-${Date.now()}@test.com`;
    const proEmail = `matching-pro-${Date.now()}@test.com`;

    const riderAAuth = await getAccessToken({ app, email: riderAEmail, role: Role.RIDER });
    riderASession = riderAAuth.session;
    riderAUserId = riderAAuth.userId;

    const riderBAuth = await getAccessToken({ app, email: riderBEmail, role: Role.RIDER });
    riderBSession = riderBAuth.session;
    riderBUserId = riderBAuth.userId;

    const riderCAuth = await getAccessToken({
      app,
      email: `matching-rider-c-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    riderCUserId = riderCAuth.userId;

    const proAuth = await getAccessToken({ app, email: proEmail, role: Role.PRO });
    proSession = proAuth.session;
    proUserId = proAuth.userId;

    const riderAProfile = await prisma.riderProfile.upsert({
      where: { userId: riderAUserId },
      create: { userId: riderAUserId, displayName: 'Rider A' },
      update: { displayName: 'Rider A' },
      select: { id: true },
    });
    riderAProfileId = riderAProfile.id;

    const riderBProfile = await prisma.riderProfile.upsert({
      where: { userId: riderBUserId },
      create: { userId: riderBUserId, displayName: 'Rider B' },
      update: { displayName: 'Rider B' },
      select: { id: true },
    });
    riderBProfileId = riderBProfile.id;

    const riderCProfile = await prisma.riderProfile.upsert({
      where: { userId: riderCUserId },
      create: { userId: riderCUserId, displayName: 'Rider C' },
      update: { displayName: 'Rider C' },
      select: { id: true },
    });
    riderCProfileId = riderCProfile.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('auth: rejects unauthenticated access', async () => {
    const anonymousSession = await createTestSession(app);

    await anonymousSession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
      .expect(401);
  });

  it('happy: creates a match and one conversation after reciprocal ACCEPT', async () => {
    await riderBSession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderAProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    const res = await riderASession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.createdConversations)).toBe(true);
    expect(res.body.createdConversations.length).toBe(1);
    expect(res.body.createdMatchesCount).toBe(1);
    // Task 3: createdConversations entries must only contain conversationId — no displayName, userId, etc.
    const entry = res.body.createdConversations[0];
    expect(typeof entry.conversationId).toBe('string');
    expect(Object.keys(entry)).toEqual(['conversationId']);

    const [one, two] = riderAUserId < riderBUserId
      ? [riderAUserId, riderBUserId]
      : [riderBUserId, riderAUserId];

    const match = await prisma.match.findUnique({
      where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } },
      select: { id: true, status: true },
    });
    expect(match?.status).toBe('ACTIVE');

    const conversation = await prisma.conversation.findUnique({
      where: { matchId: match!.id },
      select: { id: true },
    });
    expect(conversation?.id).toBeDefined();

    const memberCount = await prisma.conversationMember.count({
      where: { conversationId: conversation!.id },
    });
    expect(memberCount).toBe(2);
  });

  it('abuse/IDOR: forbids non-RIDER role on decisions endpoint', async () => {
    await proSession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderAProfileId, decision: 'ACCEPT' }] })
      .expect(403);

    const proDecisionCount = await prisma.matchDecision.count({
      where: { actorUserId: proUserId },
    });
    expect(proDecisionCount).toBe(0);
  });

  it('abuse/IDOR: ignores injected actorUserId and stores the decision for the authenticated rider only', async () => {
    await riderASession
      .post('/matching/decisions')
      .send({
        items: [
          {
            targetProfileId: riderBProfileId,
            decision: 'REFUSE',
            actorUserId: riderCUserId,
          },
        ],
      })
      .expect(200);

    const stored = await prisma.matchDecision.findUnique({
      where: {
        actorUserId_targetProfileId: {
          actorUserId: riderAUserId,
          targetProfileId: riderBProfileId,
        } as any,
      },
      select: { actorUserId: true, decision: true },
    });
    expect(stored).toEqual({ actorUserId: riderAUserId, decision: 'REFUSE' });

    const injected = await prisma.matchDecision.findUnique({
      where: {
        actorUserId_targetProfileId: {
          actorUserId: riderCUserId,
          targetProfileId: riderBProfileId,
        } as any,
      },
      select: { id: true },
    });
    expect(injected).toBeNull();
  });

  it('validation: rejects duplicate targetProfileId values inside the same batch', async () => {
    await riderASession
      .post('/matching/decisions')
      .send({
        items: [
          { targetProfileId: riderBProfileId, decision: 'ACCEPT' },
          { targetProfileId: riderBProfileId, decision: 'REFUSE' },
        ],
      })
      .expect(400);

    const stored = await prisma.matchDecision.findMany({
      where: { actorUserId: riderAUserId, targetProfileId: riderBProfileId },
      select: { id: true },
    });
    expect(stored).toHaveLength(0);
  });

  it('abuse/replay: repeating same ACCEPT does not duplicate match/conversation rows', async () => {
    await riderBSession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderAProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    await riderASession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    await riderASession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    const [one, two] = riderAUserId < riderBUserId
      ? [riderAUserId, riderBUserId]
      : [riderBUserId, riderAUserId];

    const matchCount = await prisma.match.count({
      where: { userOneId: one, userTwoId: two },
    });
    expect(matchCount).toBe(1);

    const match = await prisma.match.findUnique({
      where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } },
      select: { id: true },
    });
    expect(match?.id).toBeDefined();

    const conversationCount = await prisma.conversation.count({
      where: { matchId: match!.id },
    });
    expect(conversationCount).toBe(1);
  });

  it('race: concurrent ACCEPT calls do not create duplicate conversation or 500', async () => {
    await riderBSession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderAProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    const [res1, res2] = await Promise.all([
      riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] }),
      riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const [one, two] = riderAUserId < riderBUserId
      ? [riderAUserId, riderBUserId]
      : [riderBUserId, riderAUserId];

    const match = await prisma.match.findUnique({
      where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } },
      select: { id: true },
    });
    expect(match?.id).toBeDefined();

    const conversationCount = await prisma.conversation.count({
      where: { matchId: match!.id },
    });
    expect(conversationCount).toBe(1);

    const conversation = await prisma.conversation.findUnique({
      where: { matchId: match!.id },
      select: { id: true },
    });
    const memberCount = await prisma.conversationMember.count({
      where: { conversationId: conversation!.id },
    });
    expect(memberCount).toBe(2);
  });

  it('perf-safety: rejects payload with more than 100 decisions', async () => {
    const tooManyItems = Array.from({ length: 101 }, () => ({
      targetProfileId: riderBProfileId,
      decision: 'REFUSE',
    }));

    await riderASession
      .post('/matching/decisions')
      .send({ items: tooManyItems })
      .expect(400);
  });

  it('returns 400 for valid-but-nonexistent targetProfileId (no FK 500)', async () => {
    const missingProfileId = makeMissingProfileId(1);
    const missingProfile = await prisma.riderProfile.findUnique({
      where: { id: missingProfileId },
      select: { id: true },
    });
    expect(missingProfile).toBeNull();

    const res = await riderASession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: missingProfileId, decision: 'ACCEPT' }] })
      .expect(400);

    expect(res.body).toEqual({ error: 'Invalid input' });
  });

  it('returns same generic 400 response for two different nonexistent UUIDs (oracle hardening)', async () => {
    const missingA = makeMissingProfileId(2);
    const missingB = makeMissingProfileId(3);

    const [resA, resB] = await Promise.all([
      riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: missingA, decision: 'ACCEPT' }] }),
      riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: missingB, decision: 'ACCEPT' }] }),
    ]);

    expect(resA.status).toBe(400);
    expect(resB.status).toBe(400);
    expect(resA.body).toEqual({ error: 'Invalid input' });
    expect(resB.body).toEqual({ error: 'Invalid input' });
  });

  it('returns 429 when matching decision quota is exceeded inside transaction', async () => {
    const previousMax = process.env.MATCHING_DECISIONS_QUOTA_MAX;
    const previousWindow = process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
    process.env.MATCHING_DECISIONS_QUOTA_MAX = '1';
    process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = '24';

    try {
      await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
        .expect(200);

      const quotaRes = await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderCProfileId, decision: 'REFUSE' }] })
        .expect(429);

      expect(quotaRes.body).toEqual({ error: 'Too many requests' });
    } finally {
      if (previousMax === undefined) {
        delete process.env.MATCHING_DECISIONS_QUOTA_MAX;
      } else {
        process.env.MATCHING_DECISIONS_QUOTA_MAX = previousMax;
      }

      if (previousWindow === undefined) {
        delete process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS;
      } else {
        process.env.MATCHING_DECISIONS_QUOTA_WINDOW_HOURS = previousWindow;
      }
    }
  });

  // Updated: P1xxx (infra codes) now map to 503 'Service unavailable' instead of leaking
  // the raw Prisma error message. The old test validated a dangerous information-disclosure behaviour.
  it('maps Prisma P1xxx infra codes to 503 without leaking raw error message', async () => {
    const infraError = Object.assign(new Error('Synthetic unknown prisma error'), { code: 'P1999' });
    const txSpy = jest
      .spyOn(prisma as any, '$transaction')
      .mockRejectedValueOnce(infraError);

    try {
      const res = await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
        .expect(503);

      expect(res.body).toEqual({ error: 'Service unavailable' });
      expect(JSON.stringify(res.body)).not.toContain('Synthetic');
    } finally {
      txSpy.mockRestore();
    }
  });

  it('race/cross-user: mutual simultaneous ACCEPT creates exactly one match + one conversation + 2 members', async () => {
    // MATCHING_TEST_DELAY_MS causes the server to wait between TX commit and post-commit read,
    // ensuring both TXs have committed before either runs its reciprocal check — deterministic race.
    const previousDelay = process.env.MATCHING_TEST_DELAY_MS;
    let resA: any, resB: any;
    try {
      process.env.MATCHING_TEST_DELAY_MS = '150'; // Task 3: set inside try so finally always restores
      [resA, resB] = await Promise.all([
        riderASession
          .post('/matching/decisions')
              .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] }),
        riderBSession
          .post('/matching/decisions')
              .send({ items: [{ targetProfileId: riderAProfileId, decision: 'ACCEPT' }] }),
      ]);
    } finally {
      if (previousDelay === undefined) {
        delete process.env.MATCHING_TEST_DELAY_MS;
      } else {
        process.env.MATCHING_TEST_DELAY_MS = previousDelay;
      }
    }

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const [one, two] = riderAUserId < riderBUserId
      ? [riderAUserId, riderBUserId]
      : [riderBUserId, riderAUserId];

    // Exactly one match must exist
    const matchCount = await prisma.match.count({ where: { userOneId: one, userTwoId: two } });
    expect(matchCount).toBe(1);

    const match = await prisma.match.findUnique({
      where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } },
      select: { id: true, status: true },
    });
    expect(match?.status).toBe('ACTIVE');

    // Exactly one conversation linked to the match
    const conversationCount = await prisma.conversation.count({ where: { matchId: match!.id } });
    expect(conversationCount).toBe(1);

    const conversation = await prisma.conversation.findUnique({
      where: { matchId: match!.id },
      select: { id: true },
    });

    // Exactly 2 members (no duplicates)
    const memberCount = await prisma.conversationMember.count({
      where: { conversationId: conversation!.id },
    });
    expect(memberCount).toBe(2);
  });

  it('abuse/self: self-ACCEPT does not create a match or conversation, and is not stored in DB', async () => {
    const res = await riderASession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderAProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    // Item 3: self-decision must NOT be written to DB at all
    const selfDecision = await prisma.matchDecision.findUnique({
      where: { actorUserId_targetProfileId: { actorUserId: riderAUserId, targetProfileId: riderAProfileId } },
      select: { id: true },
    });
    expect(selfDecision).toBeNull();

    // No match created
    const matchCount = await prisma.match.count({
      where: { OR: [{ userOneId: riderAUserId, userTwoId: riderAUserId }] },
    });
    expect(matchCount).toBe(0);

    // No conversation created
    const convCount = res.body.createdConversations?.length ?? 0;
    expect(convCount).toBe(0);
    expect(res.body.createdMatchesCount).toBe(0);
  });

  it('security: unknown error does not leak raw message in NODE_ENV=production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const leakyError = new Error('SECRET_DB_HOST:5432/internal_db_name');
    const txSpy = jest
      .spyOn(prisma as any, '$transaction')
      .mockRejectedValueOnce(leakyError);

    try {
      const res = await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
        .expect(500);

      expect(res.body.error).toBe('Internal error');
      expect(JSON.stringify(res.body)).not.toContain('SECRET_DB_HOST');
    } finally {
      txSpy.mockRestore();
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('anti-amplification: post-commit pair limit caps created matches without failing the request', async () => {
    // Set limit=2 so that 3 reciprocal pairs → only 2 processed, 1 skipped silently.
    const previousLimit = process.env.MATCHING_POST_COMMIT_PAIR_LIMIT;
    try {
      process.env.MATCHING_POST_COMMIT_PAIR_LIMIT = '2';

      // Create a 3rd target rider beyond riderB and riderC already set up in beforeEach.
      const riderDAuth = await getAccessToken({
        app,
        email: `matching-rider-d-limit-${Date.now()}@test.com`,
        role: Role.RIDER,
      });
      const riderDProfile = await prisma.riderProfile.upsert({
        where: { userId: riderDAuth.userId },
        create: { userId: riderDAuth.userId, displayName: 'Rider D' },
        update: { displayName: 'Rider D' },
        select: { id: true },
      });

      // Seed reciprocal ACCEPTs from all 3 targets toward riderA (direct DB — no HTTP request).
      await prisma.matchDecision.createMany({
        data: [
          { actorUserId: riderBUserId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
          { actorUserId: riderCUserId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
          { actorUserId: riderDAuth.userId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
        ],
        skipDuplicates: true,
      });

      // RiderA sends 3 ACCEPTs in one batch → 3 reciprocal pairs found post-commit.
      const res = await riderASession
        .post('/matching/decisions')
          .send({
          items: [
            { targetProfileId: riderBProfileId, decision: 'ACCEPT' },
            { targetProfileId: riderCProfileId, decision: 'ACCEPT' },
            { targetProfileId: riderDProfile.id, decision: 'ACCEPT' },
          ],
        })
        .expect(200);

      // Limit enforced: at most 2 matches created, no error surfaced to client.
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.createdMatchesCount).toBe('number');
      expect(res.body.createdMatchesCount).toBeLessThanOrEqual(2);
      expect(Array.isArray(res.body.createdConversations)).toBe(true);
      expect(res.body.createdConversations.length).toBeLessThanOrEqual(2);
    } finally {
      if (previousLimit === undefined) {
        delete process.env.MATCHING_POST_COMMIT_PAIR_LIMIT;
      } else {
        process.env.MATCHING_POST_COMMIT_PAIR_LIMIT = previousLimit;
      }
    }
  });

  it('shape: createdConversations entries expose only conversationId (no userId/displayName/internal fields)', async () => {
    // Seed riderB → riderA ACCEPT so mutual match triggers post-commit conversation creation.
    await prisma.matchDecision.create({
      data: { actorUserId: riderBUserId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
    });

    const res = await riderASession
      .post('/matching/decisions')
      .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
      .expect(200);

    expect(res.body.createdConversations.length).toBe(1);
    const entry = res.body.createdConversations[0];
    // Only conversationId must be present — no leakage of displayName, userId, matchId, etc.
    expect(Object.keys(entry)).toEqual(['conversationId']);
    expect(typeof entry.conversationId).toBe('string');
    expect(entry.displayName).toBeUndefined();
    expect(entry.otherDisplayName).toBeUndefined();
    expect(entry.userId).toBeUndefined();
    expect(entry.matchId).toBeUndefined();
  });

  it('guard: MATCHING_POST_COMMIT_PAIR_LIMIT below 5 in production logs POST_COMMIT_PAIR_LIMIT_CLAMPED without PII', async () => {
    // Must send ACCEPT so code enters the post-commit block where the guard lives.
    // No reciprocal ACCEPT from riderB → zero conversations created, but guard still fires.
    const previousLimit = process.env.MATCHING_POST_COMMIT_PAIR_LIMIT;
    const previousNodeEnv = process.env.NODE_ENV;
    const warnSpy = jest.spyOn(secureLogger, 'warn');
    try {
      process.env.MATCHING_POST_COMMIT_PAIR_LIMIT = '1'; // dangerously low — must be clamped
      process.env.NODE_ENV = 'production';

      const res = await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
        .expect(200);

      // Request succeeds — guard clamps silently, never throws.
      expect(res.body.ok).toBe(true);

      // Exactly one POST_COMMIT_PAIR_LIMIT_CLAMPED warning must have been emitted.
      const clampCalls = warnSpy.mock.calls.filter(([event]) => event === 'POST_COMMIT_PAIR_LIMIT_CLAMPED');
      expect(clampCalls.length).toBe(1);

      const [, ctx] = clampCalls[0];
      // Verify configured/effective values are correct.
      expect(ctx?.configured).toBe(1);
      expect(ctx?.effective).toBe(5);
      // requestId must be an ephemeral string — no stable identifier.
      expect(typeof ctx?.requestId).toBe('string');
      // No PII: userId, email and similar must be absent from the logged context.
      expect(Object.keys(ctx ?? {})).toEqual(['requestId', 'configured', 'effective']);
    } finally {
      warnSpy.mockRestore();
      if (previousLimit === undefined) {
        delete process.env.MATCHING_POST_COMMIT_PAIR_LIMIT;
      } else {
        process.env.MATCHING_POST_COMMIT_PAIR_LIMIT = previousLimit;
      }
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('reliability: P1017 transient error on first post-commit mini-TX is retried and match is created', async () => {
    // Seed riderB → riderA reciprocal ACCEPT so the post-commit path creates a match.
    await prisma.matchDecision.create({
      data: { actorUserId: riderBUserId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
    });

    // Mock strategy: count function-form $transaction calls.
    //   Call 1 = main TX (must pass through — decisions are committed here).
    //   Call 2 = first mini-TX for the mutual pair → throw P1017 to simulate connection reset.
    //   Call 3 = retry mini-TX (P1001/P1017 path) → pass through → real DB → match created.
    let fnTxCallCount = 0;
    const origTransaction = (prisma as any).$transaction.bind(prisma);
    const txSpy = jest.spyOn(prisma as any, '$transaction').mockImplementation((...args: any[]) => {
      if (typeof args[0] === 'function') {
        fnTxCallCount++;
        if (fnTxCallCount === 2) {
          return Promise.reject(
            Object.assign(new Error('server closed the connection unexpectedly'), { code: 'P1017' }),
          );
        }
      }
      return origTransaction(...args);
    });

    try {
      const res = await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
        .expect(200);

      // Despite the transient P1017 on the first mini-TX, the retry succeeds.
      expect(res.body.ok).toBe(true);
      expect(res.body.createdMatchesCount).toBe(1);
      expect(res.body.createdConversations.length).toBe(1);

      // Verify the match and conversation actually exist in DB.
      const [one, two] = riderAUserId < riderBUserId
        ? [riderAUserId, riderBUserId]
        : [riderBUserId, riderAUserId];
      const match = await prisma.match.findUnique({
        where: { userOneId_userTwoId: { userOneId: one, userTwoId: two } },
        select: { id: true, status: true },
      });
      expect(match?.status).toBe('ACTIVE');
    } finally {
      txSpy.mockRestore();
    }
  });

  it('reliability: P2002 on mini-TX triggers fallback read and returns existing match/conversation idempotently', async () => {
    // Seed riderB → riderA reciprocal ACCEPT.
    await prisma.matchDecision.create({
      data: { actorUserId: riderBUserId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
    });

    // Pre-create match + conversation as if a concurrent request already inserted them.
    // The P2002 fallback path must find these rows and return without double-inserting.
    const [one, two] = riderAUserId < riderBUserId
      ? [riderAUserId, riderBUserId]
      : [riderBUserId, riderAUserId];
    const preMatch = await prisma.match.create({
      data: { userOneId: one, userTwoId: two, status: 'ACTIVE' },
      select: { id: true },
    });
    const preConv = await prisma.conversation.create({
      data: { matchId: preMatch.id },
      select: { id: true },
    });
    // No members yet — the fallback createMany(skipDuplicates) adds exactly 2.

    // Call 1 = main TX (decisions committed) → pass through.
    // Call 2 = first mini-TX for the pair → P2002 (row already exists externally).
    let fnTxCallCount = 0;
    const origTransaction = (prisma as any).$transaction.bind(prisma);
    const txSpy = jest.spyOn(prisma as any, '$transaction').mockImplementation((...args: any[]) => {
      if (typeof args[0] === 'function') {
        fnTxCallCount++;
        if (fnTxCallCount === 2) {
          return Promise.reject(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
        }
      }
      return origTransaction(...args);
    });

    try {
      const res = await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
        .expect(200);

      expect(res.body.ok).toBe(true);
      // Fallback read succeeded → match is counted as created in the response.
      expect(res.body.createdMatchesCount).toBe(1);
      expect(res.body.createdConversations.length).toBe(1);
      // conversationId must be the pre-existing one (not a newly inserted row).
      expect(res.body.createdConversations[0].conversationId).toBe(preConv.id);

      // createMany(skipDuplicates) must have added exactly 2 members — idempotent if called again.
      const memberCount = await prisma.conversationMember.count({
        where: { conversationId: preConv.id },
      });
      expect(memberCount).toBe(2);

      // No duplicate conversation must have been created for the same match.
      const convCount = await prisma.conversation.count({
        where: { matchId: preMatch.id },
      });
      expect(convCount).toBe(1);
    } finally {
      txSpy.mockRestore();
    }
  });

  it('budget: pendingReconcile retries are counted against the main loop budget — no overrun', async () => {
    // Setup: 3 reciprocal pairs (B, C, D), limit=2.
    // Expected flow:
    //   pairsAttempted=1 → B mini-TX succeeds → createdConversations.push(B)
    //   pairsAttempted=2 → C mini-TX fails (unknown error) → pendingReconcile.push(C)
    //   D → skipped (pairsAttempted >= limit) → POST_COMMIT_SKIPPED_LIMIT logged
    //   reconcile: C retry → succeeds → createdConversations.push(C)
    //   Result: 2 matches total, D untouched in DB.
    const previousLimit = process.env.MATCHING_POST_COMMIT_PAIR_LIMIT;
    const warnSpy = jest.spyOn(secureLogger, 'warn');

    const riderDAuth = await getAccessToken({
      app,
      email: `matching-rider-d-budget2-${Date.now()}@test.com`,
      role: Role.RIDER,
    });
    const riderDProfile = await prisma.riderProfile.upsert({
      where: { userId: riderDAuth.userId },
      create: { userId: riderDAuth.userId, displayName: 'Rider D budget' },
      update: { displayName: 'Rider D budget' },
      select: { id: true },
    });
    await prisma.matchDecision.createMany({
      data: [
        { actorUserId: riderBUserId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
        { actorUserId: riderCUserId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
        { actorUserId: riderDAuth.userId, targetProfileId: riderAProfileId, decision: 'ACCEPT' },
      ],
      skipDuplicates: true,
    });

    // Call 1 = main TX → pass; call 2 = B mini-TX → pass;
    // call 3 = C mini-TX → unknown error → null → pendingReconcile;
    // call 4 = reconcile C retry → pass.
    // D never gets a mini-TX call (skipped by limit before reaching $transaction).
    let fnTxCallCount = 0;
    const origTransaction = (prisma as any).$transaction.bind(prisma);
    const txSpy = jest.spyOn(prisma as any, '$transaction').mockImplementation((...args: any[]) => {
      if (typeof args[0] === 'function') {
        fnTxCallCount++;
        if (fnTxCallCount === 3) {
          // No .code → getPrismaErrorCode returns undefined → catch-all returns null → pendingReconcile.
          return Promise.reject(new Error('unexpected mini-TX failure (non-retryable code)'));
        }
      }
      return origTransaction(...args);
    });

    try {
      process.env.MATCHING_POST_COMMIT_PAIR_LIMIT = '2';

      const res = await riderASession
        .post('/matching/decisions')
          .send({
          items: [
            { targetProfileId: riderBProfileId, decision: 'ACCEPT' },
            { targetProfileId: riderCProfileId, decision: 'ACCEPT' },
            { targetProfileId: riderDProfile.id, decision: 'ACCEPT' },
          ],
        })
        .expect(200);

      expect(res.body.ok).toBe(true);
      // Budget respected: B + C (reconcile), but NOT D.
      expect(res.body.createdMatchesCount).toBeLessThanOrEqual(2);

      // POST_COMMIT_SKIPPED_LIMIT must have been emitted for D with correct ctx.
      const skipCalls = warnSpy.mock.calls.filter(([e]) => e === 'POST_COMMIT_SKIPPED_LIMIT');
      expect(skipCalls.length).toBe(1);
      const [, skipCtx] = skipCalls[0];
      expect(skipCtx?.skippedReciprocalPairsCount).toBe(1);
      // requestId is ephemeral and non-PII — must be present and be a string.
      expect(typeof skipCtx?.requestId).toBe('string');

      // D must have no match in DB — budget was never exceeded.
      const [dOne, dTwo] = riderAUserId < riderDAuth.userId
        ? [riderAUserId, riderDAuth.userId]
        : [riderDAuth.userId, riderAUserId];
      const dMatch = await prisma.match.findUnique({
        where: { userOneId_userTwoId: { userOneId: dOne, userTwoId: dTwo } },
      });
      expect(dMatch).toBeNull();
    } finally {
      txSpy.mockRestore();
      warnSpy.mockRestore();
      if (previousLimit === undefined) {
        delete process.env.MATCHING_POST_COMMIT_PAIR_LIMIT;
      } else {
        process.env.MATCHING_POST_COMMIT_PAIR_LIMIT = previousLimit;
      }
    }
  });

  it('maps Prisma P2025 to 404 on decisions endpoint', async () => {
    const txSpy = jest
      .spyOn(prisma as any, '$transaction')
      .mockRejectedValueOnce({ code: 'P2025', message: 'Record not found' });

    try {
      const res = await riderASession
        .post('/matching/decisions')
          .send({ items: [{ targetProfileId: riderBProfileId, decision: 'ACCEPT' }] })
        .expect(404);

      expect(res.body).toEqual({ error: 'Not found' });
    } finally {
      txSpy.mockRestore();
    }
  });
});
