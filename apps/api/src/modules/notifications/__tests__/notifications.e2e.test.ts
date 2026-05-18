/**
 * e2e — /notifications routes
 *
 * Contrats de sécurité vérifiés :
 *   - Anonymous → 401 sur toutes les routes
 *   - User A ne peut pas lire/modifier les notifications de user B (IDOR)
 *   - Pagination cursor fonctionne
 *   - unread-count décrémente après mark-read
 *   - mark-read idempotent (double appel → même résultat)
 *   - read-all marque tout comme lu
 *   - Zod : cursor invalide → 400
 */
import request from 'supertest';
import { createApp } from '../../../index';
import { clientPrisma as prisma, NotificationType, Role } from '@blobinfini/database';
import { getAccessToken, type TestSession } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

describe('/notifications — e2e', () => {
  const app = createApp();

  let sessionA: TestSession;
  let sessionB: TestSession;
  let userAId: string;
  let userBId: string;

  beforeEach(async () => {
    await resetDb();
    const ts = Date.now();

    const authA = await getAccessToken({ app, email: `notif-a-${ts}@test.com`, role: Role.RIDER });
    sessionA = authA.session;
    userAId = authA.userId;

    const authB = await getAccessToken({ app, email: `notif-b-${ts}@test.com`, role: Role.RIDER });
    sessionB = authB.session;
    userBId = authB.userId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─── Helper ──────────────────────────────────────────────────────────────
  async function seed(userId: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const n = await prisma.notification.create({
        data: {
          userId,
          type: NotificationType.SYSTEM,
          title: `Notification ${i}`,
          body: `Corps ${i}`,
        },
        select: { id: true },
      });
      ids.push(n.id);
    }
    return ids;
  }

  // ─── Authentication ───────────────────────────────────────────────────────

  it('GET /notifications — anonymous → 401', async () => {
    await request(app).get('/notifications').expect(401);
  });

  it('GET /notifications/unread-count — anonymous → 401', async () => {
    await request(app).get('/notifications/unread-count').expect(401);
  });

  it('PATCH /notifications/fake/read — anonymous → 401 or 403', async () => {
    // CSRF middleware returns 403 before auth for PATCH/POST without a session secret
    const res = await request(app).patch('/notifications/fake/read');
    expect([401, 403]).toContain(res.status);
  });

  it('POST /notifications/read-all — anonymous → 401 or 403', async () => {
    // CSRF middleware returns 403 before auth for PATCH/POST without a session secret
    const res = await request(app).post('/notifications/read-all');
    expect([401, 403]).toContain(res.status);
  });

  // ─── Basic list & unread-count ────────────────────────────────────────────

  it('GET /notifications — empty list for new user', async () => {
    const res = await sessionA.get('/notifications').expect(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.nextCursor).toBeNull();
  });

  it('GET /notifications/unread-count — 0 for new user', async () => {
    const res = await sessionA.get('/notifications/unread-count').expect(200);
    expect(res.body.count).toBe(0);
  });

  it('GET /notifications — returns seeded notifications in descending order', async () => {
    await seed(userAId, 3);
    const res = await sessionA.get('/notifications').expect(200);
    expect(res.body.items).toHaveLength(3);
    // Descending order: item[0].createdAt >= item[1].createdAt
    const times = res.body.items.map((n: { createdAt: string }) => new Date(n.createdAt).getTime());
    expect(times[0]).toBeGreaterThanOrEqual(times[1]);
    expect(times[1]).toBeGreaterThanOrEqual(times[2]);
  });

  it('GET /notifications/unread-count — matches seeded count', async () => {
    await seed(userAId, 5);
    const res = await sessionA.get('/notifications/unread-count').expect(200);
    expect(res.body.count).toBe(5);
  });

  // ─── IDOR — User B cannot access User A's notifications ──────────────────

  it('IDOR: User B gets empty list, not User A notifications', async () => {
    await seed(userAId, 3);

    const resB = await sessionB.get('/notifications').expect(200);
    expect(resB.body.items).toHaveLength(0);
  });

  it('IDOR: User B unread-count is 0 even if A has unread', async () => {
    await seed(userAId, 3);

    const resB = await sessionB.get('/notifications/unread-count').expect(200);
    expect(resB.body.count).toBe(0);
  });

  it('IDOR: User B cannot mark User A notification as read', async () => {
    const [idA] = await seed(userAId, 1);

    // B tries to mark A's notification — should return ok:true (no error) but
    // the updateMany WHERE userId=B ensures the row is unchanged
    await sessionB.patch(`/notifications/${idA}/read`).expect(200);

    // Verify A's notification is still unread
    const n = await prisma.notification.findUnique({ where: { id: idA }, select: { readAt: true } });
    expect(n?.readAt).toBeNull();
  });

  // ─── Mark single as read ─────────────────────────────────────────────────

  it('PATCH /notifications/:id/read — marks notification as read', async () => {
    const [id] = await seed(userAId, 1);

    await sessionA.patch(`/notifications/${id}/read`).expect(200);

    const n = await prisma.notification.findUnique({ where: { id }, select: { readAt: true } });
    expect(n?.readAt).not.toBeNull();
  });

  it('PATCH /notifications/:id/read — idempotent (second call has same effect)', async () => {
    const [id] = await seed(userAId, 1);

    await sessionA.patch(`/notifications/${id}/read`).expect(200);
    const first = await prisma.notification.findUnique({ where: { id }, select: { readAt: true } });

    await sessionA.patch(`/notifications/${id}/read`).expect(200);
    const second = await prisma.notification.findUnique({ where: { id }, select: { readAt: true } });

    // readAt must be set and unchanged after second call
    expect(first?.readAt).not.toBeNull();
    expect(second?.readAt?.toISOString()).toBe(first?.readAt?.toISOString());
  });

  it('unread-count decrements after mark-read', async () => {
    const ids = await seed(userAId, 3);

    const before = await sessionA.get('/notifications/unread-count').expect(200);
    expect(before.body.count).toBe(3);

    await sessionA.patch(`/notifications/${ids[0]}/read`).expect(200);

    const after = await sessionA.get('/notifications/unread-count').expect(200);
    expect(after.body.count).toBe(2);
  });

  // ─── Mark all as read ────────────────────────────────────────────────────

  it('POST /notifications/read-all — marks all unread as read', async () => {
    await seed(userAId, 4);

    await sessionA.post('/notifications/read-all').expect(200);

    const count = await prisma.notification.count({ where: { userId: userAId, readAt: null } });
    expect(count).toBe(0);
  });

  it('POST /notifications/read-all — does not affect User B', async () => {
    await seed(userAId, 2);
    await seed(userBId, 2);

    await sessionA.post('/notifications/read-all').expect(200);

    const countB = await prisma.notification.count({ where: { userId: userBId, readAt: null } });
    expect(countB).toBe(2);
  });

  // ─── Cursor-based pagination ─────────────────────────────────────────────

  it('cursor pagination: nextCursor provided when more items exist', async () => {
    await seed(userAId, 25);

    const res = await sessionA.get('/notifications?limit=20').expect(200);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('cursor pagination: follow cursor returns remaining items', async () => {
    await seed(userAId, 25);

    const page1 = await sessionA.get('/notifications?limit=20').expect(200);
    const cursor = page1.body.nextCursor as string;

    const page2 = await sessionA.get(`/notifications?limit=20&cursor=${encodeURIComponent(cursor)}`).expect(200);
    expect(page2.body.items).toHaveLength(5);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('cursor pagination: limit capped at 50', async () => {
    await seed(userAId, 60);
    const res = await sessionA.get('/notifications?limit=100').expect(200);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
  });

  // ─── Validation ─────────────────────────────────────────────────────────

  it('GET /notifications?cursor=invalid → 400', async () => {
    await sessionA.get('/notifications?cursor=not-a-date').expect(400);
  });

  it('GET /notifications?limit=-1 → 400', async () => {
    await sessionA.get('/notifications?limit=-1').expect(400);
  });

  it('PATCH /notifications//read — empty id → 404 or 400', async () => {
    const res = await sessionA.patch('/notifications//read');
    expect([400, 404]).toContain(res.status);
  });

  // ─── Cache headers ───────────────────────────────────────────────────────

  it('GET /notifications has Cache-Control: private, no-store', async () => {
    const res = await sessionA.get('/notifications').expect(200);
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('GET /notifications/unread-count has Cache-Control: private, no-store', async () => {
    const res = await sessionA.get('/notifications/unread-count').expect(200);
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
