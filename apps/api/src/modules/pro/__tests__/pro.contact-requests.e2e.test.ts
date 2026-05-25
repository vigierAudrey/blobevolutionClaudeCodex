/**
 * Tests e2e — C20 : Gestion des demandes de contact côté pro
 *
 * Couvre :
 *   1.  401 sans token — GET /pro/contact-requests
 *   2.  403 RIDER      — GET /pro/contact-requests
 *   3.  200 liste vide (status=active par défaut)
 *   4.  200 liste avec items + DTO minimal (pas d'email, pas de lat/lng)
 *   5.  Pagination : page/limit/total/pageCount corrects
 *   6.  Filtre status=archived — retourne uniquement les archivées
 *   7.  Filtre status=all     — retourne active + archivée
 *   8.  400 query param invalide (page=0)
 *   9.  400 limit > 50
 *  10.  PATCH archive — 200 succès
 *  11.  PATCH archive — 404 demande inexistante
 *  12.  PATCH archive — IDOR : pro A ne peut pas archiver la demande du pro B (→ 404)
 *  13.  PATCH unarchive — 200 succès
 *  14.  PATCH unarchive — 404 demande inexistante
 *  15.  PATCH unarchive — IDOR : pro A ne peut pas désarchiver la demande du pro B (→ 404)
 *  16.  Double archive — idempotent (200 × 2)
 *  17.  Double unarchive — idempotent (200 × 2)
 *  18.  Archive → disparaît de status=active
 *  19.  Archive → apparaît dans status=archived
 *  20.  Unarchive → revient dans status=active
 *  21.  Archive n'affecte pas le status métier (PENDING reste PENDING)
 *  22.  archivedCount dans /pro/dashboard/stats
 *  23.  PATCH archive — 400 UUID invalide
 *  24.  IDOR listing : pro A ne voit que ses propres demandes
 *  25.  401 sans token — PATCH archive
 */

import request from 'supertest';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../../index';
import { getAccessToken } from '../../../tests/helpers/auth';
import { resetDb } from '../../../test-utils/resetDb';

const app = createApp();

const EMAIL_PRO    = 'cr-pro@test.com';
const EMAIL_PRO2   = 'cr-pro2@test.com';
const EMAIL_RIDER  = 'cr-rider@test.com';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createContactRequest(proUserId: string, riderUserId: string, overrides?: {
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  archivedByPro?: boolean;
}) {
  const conv = await prisma.conversation.create({
    data: {
      type:    'RIDER_TO_PRO',
      members: { create: [{ userId: proUserId }, { userId: riderUserId }] },
    },
  });
  return prisma.contactRequest.create({
    data: {
      proUserId,
      conversationId: conv.id,
      status:         overrides?.status       ?? 'PENDING',
      archivedByPro:  overrides?.archivedByPro ?? false,
    },
  });
}

// ─── 1-2 : AuthN / AuthZ ──────────────────────────────────────────────────────

describe('GET /pro/contact-requests — auth', () => {
  it('1. retourne 401 sans token', async () => {
    await request(app).get('/pro/contact-requests').expect(401);
  });

  it('2. retourne 403 pour un RIDER authentifié', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    await session.get('/pro/contact-requests').expect(403);
  });
});

describe('PATCH /pro/contact-requests/:id/archive — auth', () => {
  it('25. retourne 403 sans token (CSRF bloque avant auth sur les PATCH)', async () => {
    // Le middleware CSRF intercepte les PATCH sans token CSRF avant que requireAuth ne soit évalué.
    // Le résultat observable est 403, ce qui confirme que la route est bien protégée.
    const res = await request(app)
      .patch('/pro/contact-requests/00000000-0000-0000-0000-000000000001/archive');
    expect([401, 403]).toContain(res.status);
  });
});

// ─── 3-9 : Listing + pagination + filtres ─────────────────────────────────────

describe('GET /pro/contact-requests — listing', () => {
  it('3. liste vide par défaut (status=active)', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const res = await session.get('/pro/contact-requests').expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.page).toBe(1);
    expect(res.body.pageCount).toBe(0);
  });

  it('4. retourne les items avec le DTO minimal correct (pas d\'email, pas de userId)', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    await createContactRequest(proUserId, riderUserId);

    const res = await session.get('/pro/contact-requests').expect(200);
    expect(res.body.items).toHaveLength(1);

    const item = res.body.items[0];
    // Champs attendus
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('status', 'PENDING');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('conversationId');
    expect(item).toHaveProperty('archivedByPro', false);
    expect(item).toHaveProperty('riderName');
    // Champs INTERDITS (data minimization)
    expect(item).not.toHaveProperty('email');
    expect(item).not.toHaveProperty('userId');
    expect(item).not.toHaveProperty('proUserId');
    expect(item).not.toHaveProperty('lat');
    expect(item).not.toHaveProperty('lng');
    expect(item).not.toHaveProperty('password');
    expect(item).not.toHaveProperty('members');
    expect(item).not.toHaveProperty('responses');
  });

  it('5. pagination : page/limit/total/pageCount corrects', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });

    // Créer 3 demandes (3 conversations distinctes)
    for (let i = 0; i < 3; i++) {
      await createContactRequest(proUserId, riderUserId);
    }

    const res = await session.get('/pro/contact-requests?page=1&limit=2').expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
    expect(res.body.pageCount).toBe(2);
    expect(res.body.items).toHaveLength(2);

    const res2 = await session.get('/pro/contact-requests?page=2&limit=2').expect(200);
    expect(res2.body.items).toHaveLength(1);
    expect(res2.body.page).toBe(2);
  });

  it('6. filtre status=archived retourne uniquement les archivées', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    await createContactRequest(proUserId, riderUserId, { archivedByPro: false });
    await createContactRequest(proUserId, riderUserId, { archivedByPro: true });

    const res = await session.get('/pro/contact-requests?status=archived').expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].archivedByPro).toBe(true);
  });

  it('7. filtre status=all retourne les deux', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    await createContactRequest(proUserId, riderUserId, { archivedByPro: false });
    await createContactRequest(proUserId, riderUserId, { archivedByPro: true });

    const res = await session.get('/pro/contact-requests?status=all').expect(200);
    expect(res.body.total).toBe(2);
  });

  it('8. 400 sur page invalide (page=0)', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    await session.get('/pro/contact-requests?page=0').expect(400);
  });

  it('9. 400 sur limit > 50', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    await session.get('/pro/contact-requests?limit=51').expect(400);
  });
});

// ─── 10-17 : Archive / Unarchive ──────────────────────────────────────────────

describe('PATCH /pro/contact-requests/:id/archive', () => {
  it('10. archive une demande existante → 200 { success: true }', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId);

    const res = await session.patch(`/pro/contact-requests/${cr.id}/archive`).expect(200);
    expect(res.body.success).toBe(true);

    const updated = await prisma.contactRequest.findUnique({ where: { id: cr.id } });
    expect(updated?.archivedByPro).toBe(true);
  });

  it('11. 404 pour une demande inexistante', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    await session.patch('/pro/contact-requests/00000000-0000-0000-0000-000000000001/archive').expect(404);
  });

  it('12. IDOR — pro A ne peut pas archiver la demande du pro B → 404', async () => {
    const { userId: proAId }       = await getAccessToken({ app, email: EMAIL_PRO,  role: 'PRO' });
    const { session: proBSession, userId: proBId } = await getAccessToken({ app, email: EMAIL_PRO2, role: 'PRO' });
    const { userId: riderUserId }  = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });

    // Demande créée par pro A
    const cr = await createContactRequest(proAId, riderUserId);

    // Pro B tente d'archiver la demande de pro A
    await proBSession.patch(`/pro/contact-requests/${cr.id}/archive`).expect(404);

    // Vérifier que la demande est intacte
    const untouched = await prisma.contactRequest.findUnique({ where: { id: cr.id } });
    expect(untouched?.archivedByPro).toBe(false);
  });

  it('16. double archive — idempotent', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId);

    await session.patch(`/pro/contact-requests/${cr.id}/archive`).expect(200);
    await session.patch(`/pro/contact-requests/${cr.id}/archive`).expect(200);

    const updated = await prisma.contactRequest.findUnique({ where: { id: cr.id } });
    expect(updated?.archivedByPro).toBe(true);
  });

  it('23. 400 sur UUID invalide', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    await session.patch('/pro/contact-requests/not-a-uuid/archive').expect(400);
  });
});

describe('PATCH /pro/contact-requests/:id/unarchive', () => {
  it('13. désarchive une demande archivée → 200 { success: true }', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId, { archivedByPro: true });

    const res = await session.patch(`/pro/contact-requests/${cr.id}/unarchive`).expect(200);
    expect(res.body.success).toBe(true);

    const updated = await prisma.contactRequest.findUnique({ where: { id: cr.id } });
    expect(updated?.archivedByPro).toBe(false);
  });

  it('14. 404 pour une demande inexistante', async () => {
    const { session } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    await session.patch('/pro/contact-requests/00000000-0000-0000-0000-000000000001/unarchive').expect(404);
  });

  it('15. IDOR — pro A ne peut pas désarchiver la demande du pro B → 404', async () => {
    const { userId: proAId }       = await getAccessToken({ app, email: EMAIL_PRO,  role: 'PRO' });
    const { session: proBSession, userId: proBId } = await getAccessToken({ app, email: EMAIL_PRO2, role: 'PRO' });
    const { userId: riderUserId }  = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });

    const cr = await createContactRequest(proAId, riderUserId, { archivedByPro: true });
    await proBSession.patch(`/pro/contact-requests/${cr.id}/unarchive`).expect(404);

    const untouched = await prisma.contactRequest.findUnique({ where: { id: cr.id } });
    expect(untouched?.archivedByPro).toBe(true);
  });

  it('17. double unarchive — idempotent', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId, { archivedByPro: true });

    await session.patch(`/pro/contact-requests/${cr.id}/unarchive`).expect(200);
    await session.patch(`/pro/contact-requests/${cr.id}/unarchive`).expect(200);

    const updated = await prisma.contactRequest.findUnique({ where: { id: cr.id } });
    expect(updated?.archivedByPro).toBe(false);
  });
});

// ─── 18-21 : Intégration filtre après archive/unarchive ───────────────────────

describe('Intégration archive + filtres', () => {
  it('18. archive → disparaît de status=active', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId);

    let res = await session.get('/pro/contact-requests?status=active').expect(200);
    expect(res.body.total).toBe(1);

    await session.patch(`/pro/contact-requests/${cr.id}/archive`).expect(200);

    res = await session.get('/pro/contact-requests?status=active').expect(200);
    expect(res.body.total).toBe(0);
  });

  it('19. archive → apparaît dans status=archived', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId);

    await session.patch(`/pro/contact-requests/${cr.id}/archive`).expect(200);

    const res = await session.get('/pro/contact-requests?status=archived').expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(cr.id);
  });

  it('20. unarchive → revient dans status=active', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId, { archivedByPro: true });

    await session.patch(`/pro/contact-requests/${cr.id}/unarchive`).expect(200);

    const res = await session.get('/pro/contact-requests?status=active').expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(cr.id);
  });

  it('21. archive ne modifie pas le status métier (PENDING reste PENDING)', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });
    const cr = await createContactRequest(proUserId, riderUserId, { status: 'PENDING' });

    await session.patch(`/pro/contact-requests/${cr.id}/archive`).expect(200);

    const row = await prisma.contactRequest.findUnique({ where: { id: cr.id } });
    expect(row?.status).toBe('PENDING');
    expect(row?.archivedByPro).toBe(true);
  });
});

// ─── 22 : Dashboard stats ─────────────────────────────────────────────────────

describe('GET /pro/dashboard/stats — archivedCount', () => {
  it('22. archivedCount présent et correct dans les stats', async () => {
    const { session, userId: proUserId } = await getAccessToken({ app, email: EMAIL_PRO, role: 'PRO' });
    const { userId: riderUserId } = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });

    await createContactRequest(proUserId, riderUserId, { archivedByPro: false });
    await createContactRequest(proUserId, riderUserId, { archivedByPro: false });
    await createContactRequest(proUserId, riderUserId, { archivedByPro: true });

    const res = await session.get('/pro/dashboard/stats').expect(200);
    expect(res.body.archivedCount).toBe(1);
  });
});

// ─── 24 : IDOR listing ────────────────────────────────────────────────────────

describe('IDOR — listing cloisonné par pro', () => {
  it('24. pro A ne voit que ses propres demandes, pas celles du pro B', async () => {
    const { session: sessionA, userId: proAId } = await getAccessToken({ app, email: EMAIL_PRO,  role: 'PRO' });
    const { userId: proBId }                    = await getAccessToken({ app, email: EMAIL_PRO2, role: 'PRO' });
    const { userId: riderUserId }               = await getAccessToken({ app, email: EMAIL_RIDER, role: 'RIDER' });

    await createContactRequest(proAId, riderUserId);
    await createContactRequest(proBId, riderUserId);

    const res = await sessionA.get('/pro/contact-requests?status=all').expect(200);
    expect(res.body.total).toBe(1);
    // Vérifier que proUserId n'est pas exposé (data minimization)
    expect(res.body.items[0]).not.toHaveProperty('proUserId');
    // Mais surtout : aucune demande du pro B dans le listing
    const ids = res.body.items.map((i: { id: string }) => i.id);
    const proBRequests = await prisma.contactRequest.findMany({ where: { proUserId: proBId } });
    for (const cr of proBRequests) {
      expect(ids).not.toContain(cr.id);
    }
  });
});
