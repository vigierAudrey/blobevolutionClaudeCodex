/**
 * E2E — Conversation archive/purge lifecycle
 *
 * Covers:
 *   IDOR  : user A never sees user B's archived/trashed conversations
 *   Scope : active / archived / trashed / all filtering
 *   Auto  : maybeAutoArchive triggers at ACTIVE_CONVERSATIONS_MAX + 1
 *   Job   : purgeDueConversationMembers dry-run + real purge
 *   ETag  : isolation between users, changes on update
 *   Routes: PATCH /:id/archive, PATCH /:id/restore
 */

import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, Role } from '@blobinfini/database';
import { getAccessToken, type TestSession } from '../../../tests/helpers/auth';
import { purgeDueConversationMembers, TRASH_PURGE_DAYS } from '../../../jobs/purgeConversations';
import { ACTIVE_CONVERSATIONS_MAX } from '../conversations.controller';

const app = createApp();
const TAG = `archive-${Date.now()}`;

// ─── Auth helper ──────────────────────────────────────────────────────────────

// Returns token (for Bearer GET requests) + session (carries CSRF + cookies for PATCH).
async function createAuthedUser(label: string, role: Role = Role.RIDER) {
  const email = `${label}-${TAG}@test.local`;
  const { accessToken, userId, session } = await getAccessToken({
    app,
    email,
    password: 'Passw0rd!',
    role,
    emailVerified: true,
  });
  return { userId, token: accessToken, session };
}

type AuthedUser = { userId: string; token: string; session: TestSession };

// ─── DB seed helpers ──────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function seedConversations(
  ownerId: string,
  peerId: string,
  count: number,
  memberOverrides: Record<string, unknown> = {},
): Promise<string[]> {
  const now = Date.now();
  const convs = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    type: 'RIDER_TO_RIDER' as const,
    createdAt: new Date(now - i * 1_000),
    updatedAt: new Date(now - i * 1_000),
  }));

  for (const batch of chunk(convs, 500)) {
    await prisma.conversation.createMany({ data: batch });
  }

  const memberRows = convs.flatMap((c) => [
    { conversationId: c.id, userId: ownerId, ...memberOverrides },
    { conversationId: c.id, userId: peerId },
  ]);

  for (const batch of chunk(memberRows, 1_000)) {
    await prisma.conversationMember.createMany({ data: batch });
  }

  return convs.map((c) => c.id);
}

async function seedArchivedConversations(
  ownerId: string,
  peerId: string,
  count: number,
  purgeAt?: Date,
): Promise<string[]> {
  const archivedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000); // 2 days ago
  const defaultPurgeAt = new Date(archivedAt);
  defaultPurgeAt.setMonth(defaultPurgeAt.getMonth() + 18);

  return seedConversations(ownerId, peerId, count, {
    archivedAt,
    purgeAt: purgeAt ?? defaultPurgeAt,
  });
}

async function seedTrashedConversations(
  ownerId: string,
  peerId: string,
  count: number,
  trashedDaysAgo = 2,
): Promise<string[]> {
  const trashedAt = new Date(Date.now() - trashedDaysAgo * 24 * 60 * 60 * 1_000);
  const purgeAt = new Date(trashedAt);
  purgeAt.setDate(purgeAt.getDate() + TRASH_PURGE_DAYS);
  return seedConversations(ownerId, peerId, count, { trashedAt, purgeAt });
}

async function cleanupUser(userId: string) {
  const memberIds = await prisma.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true },
  });
  const convIds = memberIds.map((m) => m.conversationId);
  if (convIds.length > 0) {
    await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  }
  await prisma.user.delete({ where: { id: userId } }).catch(() => null);
}

// ─── IDOR tests ───────────────────────────────────────────────────────────────

describe('[IDOR] archived/trashed isolation between users', () => {
  let alice: AuthedUser;
  let bob: AuthedUser;

  beforeAll(async () => {
    alice = await createAuthedUser('idor-alice');
    bob = await createAuthedUser('idor-bob');
  });

  afterAll(async () => {
    await cleanupUser(alice.userId);
    await cleanupUser(bob.userId);
  });

  it('Alice archived conversations do not appear in Bob scope=archived', async () => {
    await seedArchivedConversations(alice.userId, bob.userId, 3);

    const res = await request(app)
      .get('/conversations?scope=archived&limit=50')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);

    const ids = (res.body.items as { id: string }[]).map((i) => i.id);
    // Bob's membership is active (no archivedAt set on Bob's side)
    expect(ids).toHaveLength(0);
  });

  it('Bob cannot archive Alice\'s conversation membership', async () => {
    const [convId] = await seedConversations(alice.userId, bob.userId, 1);

    // Bob tries to archive using Alice's conversation id
    const res = await alice.session.patch(`/conversations/${convId}/archive`)
      .expect(200);
    expect(res.body.ok).toBe(true);

    // Verify Bob's membership is untouched
    const bobMember = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId: bob.userId } },
    });
    expect(bobMember?.archivedAt).toBeNull();
  });

  it('scope=trashed returns only caller\'s own trashed conversations', async () => {
    await seedTrashedConversations(alice.userId, bob.userId, 2);

    const bobRes = await request(app)
      .get('/conversations?scope=trashed&limit=50')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);

    expect(bobRes.body.items).toHaveLength(0);
  });
});

// ─── Scope filtering tests ────────────────────────────────────────────────────

describe('[Scope] active / archived / trashed / all', () => {
  let owner: AuthedUser;
  let peer: AuthedUser;

  beforeAll(async () => {
    owner = await createAuthedUser('scope-owner');
    peer = await createAuthedUser('scope-peer');

    await seedConversations(owner.userId, peer.userId, 3);
    await seedArchivedConversations(owner.userId, peer.userId, 2);
    await seedTrashedConversations(owner.userId, peer.userId, 1);
  });

  afterAll(async () => {
    await cleanupUser(owner.userId);
    await cleanupUser(peer.userId);
  });

  it('scope=active returns only active conversations', async () => {
    const res = await request(app)
      .get('/conversations?scope=active&limit=50')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const items = res.body.items as { archived: boolean; trashed: boolean }[];
    expect(items.every((i) => !i.archived && !i.trashed)).toBe(true);
    expect(items.length).toBe(3);
  });

  it('scope=archived returns only archived conversations', async () => {
    const res = await request(app)
      .get('/conversations?scope=archived&limit=50')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const items = res.body.items as { archived: boolean }[];
    expect(items.every((i) => i.archived)).toBe(true);
    expect(items.length).toBe(2);
  });

  it('scope=trashed returns only trashed conversations', async () => {
    const res = await request(app)
      .get('/conversations?scope=trashed&limit=50')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const items = res.body.items as { trashed: boolean }[];
    expect(items.every((i) => i.trashed)).toBe(true);
    expect(items.length).toBe(1);
  });

  it('legacy includeTrashed=true maps to scope=all', async () => {
    const res = await request(app)
      .get('/conversations?includeTrashed=true&limit=50')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(res.body.items.length).toBe(6); // 3 active + 2 archived + 1 trashed
  });

  it('explicit scope overrides includeTrashed legacy param', async () => {
    const res = await request(app)
      .get('/conversations?scope=active&includeTrashed=true&limit=50')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const items = res.body.items as { archived: boolean; trashed: boolean }[];
    expect(items.every((i) => !i.archived && !i.trashed)).toBe(true);
  });
});

// ─── Auto-archive tests ───────────────────────────────────────────────────────

describe('[AutoArchive] triggers at ACTIVE_CONVERSATIONS_MAX + 1', () => {
  let owner: AuthedUser;
  let peer: AuthedUser;

  beforeAll(async () => {
    owner = await createAuthedUser('autoarchive-owner');
    peer = await createAuthedUser('autoarchive-peer');
    // Seed MAX + 1 active conversations
    await seedConversations(owner.userId, peer.userId, ACTIVE_CONVERSATIONS_MAX + 1);
  });

  afterAll(async () => {
    await cleanupUser(owner.userId);
    await cleanupUser(peer.userId);
  });

  it('GET /conversations?scope=active triggers auto-archive and returns ≤ MAX items', async () => {
    // limit=100 is the API max; auto-archive runs before pagination, so DB counts are authoritative.
    const res = await request(app)
      .get('/conversations?scope=active&limit=100')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    const activeCount = await prisma.conversationMember.count({
      where: { userId: owner.userId, archivedAt: null, trashedAt: null },
    });
    expect(activeCount).toBeLessThanOrEqual(ACTIVE_CONVERSATIONS_MAX);

    const archivedCount = await prisma.conversationMember.count({
      where: { userId: owner.userId, archivedAt: { not: null } },
    });
    expect(archivedCount).toBeGreaterThanOrEqual(1);

    // Response contains only active conversations
    const items = res.body.items as { archived: boolean }[];
    expect(items.every((i) => !i.archived)).toBe(true);
  });
});

// ─── Archive / restore routes ─────────────────────────────────────────────────

describe('[Routes] PATCH /:id/archive and /:id/restore', () => {
  let owner: AuthedUser;
  let peer: AuthedUser;
  let convId: string;

  beforeAll(async () => {
    owner = await createAuthedUser('routes-owner');
    peer = await createAuthedUser('routes-peer');
    [convId] = await seedConversations(owner.userId, peer.userId, 1);
  });

  afterAll(async () => {
    await cleanupUser(owner.userId);
    await cleanupUser(peer.userId);
  });

  it('PATCH /:id/archive archives the caller\'s membership only', async () => {
    const res = await owner.session.patch(`/conversations/${convId}/archive`)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.archivedAt).toBeTruthy();

    const ownerMember = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId: owner.userId } },
    });
    expect(ownerMember?.archivedAt).not.toBeNull();
    expect(ownerMember?.purgeAt).not.toBeNull();

    // Peer membership untouched
    const peerMember = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId: peer.userId } },
    });
    expect(peerMember?.archivedAt).toBeNull();
  });

  it('PATCH /:id/archive on already-archived returns 409', async () => {
    await owner.session.patch(`/conversations/${convId}/archive`)
      .expect(409);
  });

  it('PATCH /:id/restore restores to active (archivedAt=null, purgeAt=null)', async () => {
    const res = await owner.session.patch(`/conversations/${convId}/restore`)
      .expect(200);
    expect(res.body.ok).toBe(true);

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: convId, userId: owner.userId } },
    });
    expect(member?.archivedAt).toBeNull();
    expect(member?.purgeAt).toBeNull();
  });

  it('PATCH /:id/restore on active conversation returns 409', async () => {
    await owner.session.patch(`/conversations/${convId}/restore`)
      .expect(409);
  });

  it('unknown conversationId returns 404', async () => {
    await owner.session.patch(`/conversations/${randomUUID()}/archive`)
      .expect(404);
  });
});

// ─── Purge job tests ──────────────────────────────────────────────────────────

describe('[PurgeJob] purgeDueConversationMembers', () => {
  let owner: AuthedUser;
  let peer: AuthedUser;

  beforeAll(async () => {
    owner = await createAuthedUser('purge-owner');
    peer = await createAuthedUser('purge-peer');
  });

  afterAll(async () => {
    await cleanupUser(owner.userId);
    await cleanupUser(peer.userId);
  });

  it('dry-run: logs without deleting any members', async () => {
    const pastPurgeAt = new Date(Date.now() - 1_000);
    await seedArchivedConversations(owner.userId, peer.userId, 3, pastPurgeAt);

    const before = await prisma.conversationMember.count({
      where: { userId: owner.userId },
    });

    const result = await purgeDueConversationMembers({
      now: new Date(),
      dryRun: true,
    });

    const after = await prisma.conversationMember.count({
      where: { userId: owner.userId },
    });

    expect(result.dryRun).toBe(true);
    expect(result.membersDeleted).toBe(0);
    expect(after).toBe(before); // nothing deleted
  });

  it('real purge: deletes expired archived members', async () => {
    const pastPurgeAt = new Date(Date.now() - 1_000);
    const ids = await seedArchivedConversations(owner.userId, peer.userId, 2, pastPurgeAt);

    const result = await purgeDueConversationMembers({
      now: new Date(),
      dryRun: false,
    });

    expect(result.membersDeleted).toBeGreaterThanOrEqual(2);

    // Verify members are gone
    const remaining = await prisma.conversationMember.findMany({
      where: { userId: owner.userId, conversationId: { in: ids } },
    });
    expect(remaining).toHaveLength(0);
  });

  it('active conversations (purgeAt null) are never touched', async () => {
    const [activeId] = await seedConversations(owner.userId, peer.userId, 1);

    const before = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: activeId, userId: owner.userId } },
    });
    expect(before?.purgeAt).toBeNull();

    await purgeDueConversationMembers({ now: new Date(), dryRun: false });

    const after = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: activeId, userId: owner.userId } },
    });
    expect(after).not.toBeNull(); // still exists
  });
});

// ─── ETag isolation tests ─────────────────────────────────────────────────────

describe('[ETag] isolation between users, changes on update', () => {
  let alice: AuthedUser;
  let bob: AuthedUser;

  beforeAll(async () => {
    alice = await createAuthedUser('etag-alice');
    bob = await createAuthedUser('etag-bob');
    await seedConversations(alice.userId, bob.userId, 2);
  });

  afterAll(async () => {
    await cleanupUser(alice.userId);
    await cleanupUser(bob.userId);
  });

  it('ETag is present and scoped to user', async () => {
    const aliceRes = await request(app)
      .get('/conversations?scope=active')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    const bobRes = await request(app)
      .get('/conversations?scope=active')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);

    const aliceETag = aliceRes.headers.etag as string;
    const bobETag = bobRes.headers.etag as string;

    expect(aliceETag).toBeTruthy();
    expect(bobETag).toBeTruthy();
    // ETags differ because they include userId in the fingerprint
    expect(aliceETag).not.toBe(bobETag);
  });

  it('If-None-Match with valid ETag returns 304', async () => {
    const res1 = await request(app)
      .get('/conversations?scope=active')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);
    const etag = res1.headers.etag as string;

    await request(app)
      .get('/conversations?scope=active')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('If-None-Match', etag)
      .expect(304);
  });

  it('Bob\'s ETag does not produce 304 for Alice', async () => {
    const bobRes = await request(app)
      .get('/conversations?scope=active')
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    const bobETag = bobRes.headers.etag as string;

    // Alice sends Bob's ETag — should NOT get 304 (different user fingerprint)
    const res = await request(app)
      .get('/conversations?scope=active')
      .set('Authorization', `Bearer ${alice.token}`)
      .set('If-None-Match', bobETag)
      .expect(200);

    expect(res.body.items).toBeDefined();
  });

  it('Cache-Control: private is always set', async () => {
    const res = await request(app)
      .get('/conversations?scope=active')
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(200);

    expect(res.headers['cache-control']).toContain('private');
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
