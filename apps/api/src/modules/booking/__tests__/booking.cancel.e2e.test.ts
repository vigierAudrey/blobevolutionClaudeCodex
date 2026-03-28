/**
 * Tests e2e — annulation de booking (patch minimal P0/P1)
 *
 * Couvre :
 * - happy path rider cancel
 * - happy path pro cancel
 * - IDOR rider (ne peut pas annuler le booking d'un autre)
 * - IDOR pro (ne peut pas annuler un booking d'une autre disponibilité)
 * - idempotence : double cancel → 409
 * - UUID invalide → 400
 * - booking inexistant → 404
 * - fenêtre temporelle : rider bloqué si leçon < cutoff
 * - pro non soumis à la fenêtre
 * - POST /bookings/manual supprimé → 404 pour tous les appelants (décision produit 2026-03-24)
 * - createRequest refusé si availability CLOSED
 * - createRequest refusé si availability inexistante
 * - createRequest refusé si self-booking
 * - adjustBookedCount refusé au PRO
 * - adjustBookedCount reason trop courte → 400
 * - updateAvailability bloqué si modif schedule avec bookings confirmés
 * - updateAvailability bloqué si capacity réduite sous confirmedCount
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { clientPrisma as prisma, BookingStatus } from '@blobinfini/database';
import { createApp } from '../../../index';
import { createTestSession, type TestSession } from '../../../tests/helpers/auth';
import { AVAILABLE_PERMISSIONS } from '../../admin/permissions';
import type { CreateAvailabilityInput } from '../dto/createAvailability.dto';

const app = createApp();

function signToken(userId: string, role: string) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, { expiresIn: '1h' });
}

// ─── Emails spécifiques à cette suite ────────────────────────────────────────
const E = {
  pro:      'pro-cancel-test@test.com',
  proOther: 'pro-cancel-other@test.com',
  rider:    'rider-cancel-test@test.com',
  rider2:   'rider-cancel-test-2@test.com',
} as const;

// ─── State module-level ───────────────────────────────────────────────────────
let proId:      string;
let proOtherId: string;
let riderId:    string;
let rider2Id:   string;
let adminId:    string;

let proToken:      string;
let proOtherToken: string;
let riderToken:    string;
let rider2Token:   string;
let adminToken:    string;

let proSession:      TestSession;
let riderSession:    TestSession;
let rider2Session:   TestSession;
let proOtherSession: TestSession;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function cleanBookingData() {
  await prisma.booking.deleteMany({
    where: { rider: { email: { in: Object.values(E) } } },
  });
  await prisma.bookingRequest.deleteMany({
    where: { rider: { email: { in: Object.values(E) } } },
  });
  await prisma.proAvailability.deleteMany({
    where: { pro: { email: { in: [E.pro, E.proOther] } } },
  });
}

async function createAvailability(opts: Partial<CreateAvailabilityInput> & { session?: TestSession; token?: string } = {}) {
  const { session: sess = proSession, token = proToken, ...overrides } = opts;
  const payload: CreateAvailabilityInput = {
    sport: 'surf',
    levels: ['beginner'],
    startAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    endAt:   new Date(Date.now() + 5 * 3_600_000).toISOString(),
    capacity: 3,
    spotName: 'Plage Test',
    spotLat: 43.493,
    spotLng: -1.558,
    ...overrides,
  };
  const res = await sess
    .post('/booking/availability')
    .set('Authorization', `Bearer ${token}`)
    .send(payload)
    .expect(201);
  return res.body as { id: string };
}

async function createConfirmedBooking(availabilityId: string, riderUserId: string = riderId) {
  const booking = await prisma.booking.create({
    data: { availabilityId, riderUserId, status: 'CONFIRMED' },
  });
  const count = await prisma.booking.count({ where: { availabilityId, status: 'CONFIRMED' } });
  await prisma.proAvailability.update({ where: { id: availabilityId }, data: { bookedCount: count } });
  return booking;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
// Pattern: beforeEach pour tout (resetDb() global détruit les users après chaque test).
// On utilise signToken() directement — pas de HTTP login, pas de rate-limit.
// Les sessions CSRF sont créées via createTestSession (GET /csrf-token, pas d'auth).

const CONSENT_VERSION = 'v1.0.0';

async function setupActors() {
  const hashedPwd = await bcrypt.hash('Passw0rd!', 12);

  // ── PRO ──
  const pro = await prisma.user.upsert({
    where: { email: E.pro },
    create: { email: E.pro, password: hashedPwd, role: 'PRO', emailVerified: true, consentedAt: new Date(), consentVersion: CONSENT_VERSION },
    update: { emailVerified: true },
  });
  proId = pro.id;
  proToken = signToken(proId, 'PRO');
  await prisma.proProfile.upsert({
    where: { userId: proId },
    create: { userId: proId, lat: 43.493, lng: -1.558, verified: true },
    update: { lat: 43.493, lng: -1.558 },
  });

  // ── PRO OTHER ──
  const proOther = await prisma.user.upsert({
    where: { email: E.proOther },
    create: { email: E.proOther, password: hashedPwd, role: 'PRO', emailVerified: true, consentedAt: new Date(), consentVersion: CONSENT_VERSION },
    update: { emailVerified: true },
  });
  proOtherId = proOther.id;
  proOtherToken = signToken(proOtherId, 'PRO');
  await prisma.proProfile.upsert({
    where: { userId: proOtherId },
    create: { userId: proOtherId, lat: 43.5, lng: -1.6, verified: true },
    update: { lat: 43.5, lng: -1.6 },
  });

  // ── RIDER ──
  const rider = await prisma.user.upsert({
    where: { email: E.rider },
    create: { email: E.rider, password: hashedPwd, role: 'RIDER', emailVerified: true, consentedAt: new Date(), consentVersion: CONSENT_VERSION },
    update: { emailVerified: true },
  });
  riderId = rider.id;
  riderToken = signToken(riderId, 'RIDER');

  // ── RIDER 2 ──
  const rider2 = await prisma.user.upsert({
    where: { email: E.rider2 },
    create: { email: E.rider2, password: hashedPwd, role: 'RIDER', emailVerified: true, consentedAt: new Date(), consentVersion: CONSENT_VERSION },
    update: { emailVerified: true },
  });
  rider2Id = rider2.id;
  rider2Token = signToken(rider2Id, 'RIDER');

  // ── ADMIN ──
  const admin = await prisma.user.upsert({
    where: { email: 'admin-cancel-test@test.com' },
    create: { email: 'admin-cancel-test@test.com', password: hashedPwd, role: 'ADMIN', emailVerified: true },
    update: { emailVerified: true },
  });
  adminId = admin.id;
  adminToken = signToken(adminId, 'ADMIN');
  await prisma.adminProfile.upsert({
    where: { userId: adminId },
    create: { userId: adminId, displayName: 'Test Admin Cancel', permissions: [...AVAILABLE_PERMISSIONS] },
    update: { permissions: [...AVAILABLE_PERMISSIONS] },
  });

  // ── CSRF sessions (GET /csrf-token — pas d'auth, pas de rate-limit) ──
  // Les sessions n'ont PAS de cookie accessToken : pas de CONFLICT avec le Bearer.
  proSession      = await createTestSession(app);
  proOtherSession = await createTestSession(app);
  riderSession    = await createTestSession(app);
  rider2Session   = await createTestSession(app);
}

beforeEach(async () => {
  await setupActors();
  // Les données booking sont déjà nettoyées par le resetDb() global (afterEach).
  // cleanBookingData() ici serait un no-op, on l'omet.
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── 1. CANCEL — happy paths ──────────────────────────────────────────────────

describe('POST /booking/bookings/:id/cancel — happy paths', () => {
  it('rider annule son booking — statut CANCELLED_RIDER, bookedCount recompute, availability rouvre', async () => {
    const avail = await createAvailability({ capacity: 2 });
    const booking = await createConfirmedBooking(avail.id, riderId);
    await createConfirmedBooking(avail.id, rider2Id); // 2ème booking — availability doit rester OPEN après cancel du 1er

    const res = await riderSession
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('CANCELLED_RIDER');
    expect(res.body.cancelledAt).toBeTruthy();

    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.status).toBe(BookingStatus.CANCELLED_RIDER);
    expect(updatedBooking?.cancelledAt).not.toBeNull();

    const updatedAvail = await prisma.proAvailability.findUnique({ where: { id: avail.id } });
    expect(updatedAvail?.status).toBe('OPEN');
    expect(updatedAvail?.bookedCount).toBe(1); // recompute COUNT après cancel
  });

  it('pro annule un booking de son slot — statut CANCELLED_PRO, availability rouvre', async () => {
    const avail = await createAvailability({ capacity: 1 });
    const booking = await createConfirmedBooking(avail.id, riderId);
    await prisma.proAvailability.update({ where: { id: avail.id }, data: { status: 'CLOSED' } });

    const res = await proSession
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(res.body.status).toBe('CANCELLED_PRO');

    const updatedAvail = await prisma.proAvailability.findUnique({ where: { id: avail.id } });
    expect(updatedAvail?.status).toBe('OPEN');
    expect(updatedAvail?.bookedCount).toBe(0);
  });
});

// ─── 2. CANCEL — IDOR ────────────────────────────────────────────────────────

describe('POST /booking/bookings/:id/cancel — IDOR', () => {
  it('rider2 ne peut pas annuler le booking de rider1 — 403, booking inchangé', async () => {
    const avail = await createAvailability();
    const booking = await createConfirmedBooking(avail.id, riderId);

    const res = await rider2Session
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${rider2Token}`)
      .expect(403);

    expect(res.body.error).toMatch(/Forbidden/i);
    const unchanged = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(unchanged?.status).toBe(BookingStatus.CONFIRMED);
  });

  it('proOther ne peut pas annuler un booking d\'une disponibilité qui ne lui appartient pas — 403', async () => {
    const avail = await createAvailability(); // appartient à `pro`, pas à `proOther`
    const booking = await createConfirmedBooking(avail.id, riderId);

    const res = await proOtherSession
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${proOtherToken}`)
      .expect(403);

    expect(res.body.error).toMatch(/Forbidden/i);
    const unchanged = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(unchanged?.status).toBe(BookingStatus.CONFIRMED);
  });
});

// ─── 3. CANCEL — invariants état ─────────────────────────────────────────────

describe('POST /booking/bookings/:id/cancel — invariants métier', () => {
  it('double cancel — second appel → 409 not cancellable', async () => {
    const avail = await createAvailability();
    const booking = await createConfirmedBooking(avail.id, riderId);

    await riderSession
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(200);

    const res2 = await riderSession
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(409);

    expect(res2.body.error).toMatch(/not cancellable/i);
  });

  it('UUID invalide → 400', async () => {
    await riderSession
      .post('/booking/bookings/not-a-uuid/cancel')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(400);
  });

  it('booking inexistant → 404', async () => {
    await riderSession
      .post('/booking/bookings/00000000-0000-0000-0000-000000000000/cancel')
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(404);
  });
});

// ─── 4. CANCEL — fenêtre temporelle ──────────────────────────────────────────

describe('POST /booking/bookings/:id/cancel — fenêtre temporelle', () => {
  it('rider bloqué si leçon dans moins de 2h — 409, booking inchangé', async () => {
    const avail = await createAvailability({
      startAt: new Date(Date.now() + 1 * 3_600_000).toISOString(),
      endAt:   new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    const booking = await createConfirmedBooking(avail.id, riderId);

    const res = await riderSession
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${riderToken}`)
      .expect(409);

    expect(res.body.error).toMatch(/window closed/i);
    const unchanged = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(unchanged?.status).toBe(BookingStatus.CONFIRMED);
  });

  it('pro non soumis à la fenêtre — peut annuler même leçon imminente', async () => {
    const avail = await createAvailability({
      startAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      endAt:   new Date(Date.now() + 90 * 60_000).toISOString(),
    });
    const booking = await createConfirmedBooking(avail.id, riderId);

    const res = await proSession
      .post(`/booking/bookings/${booking.id}/cancel`)
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(res.body.status).toBe('CANCELLED_PRO');
  });
});

// ─── 5. POST /bookings/manual — route supprimée (décision produit 2026-03-24) ─
// La capacité de création manuelle admin a été supprimée.
// La route ne doit plus exister pour aucun appelant.

describe('POST /booking/bookings/manual — route supprimée', () => {
  it('404 pour un PRO authentifié', async () => {
    await proSession
      .post('/booking/bookings/manual')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ availabilityId: '00000000-0000-0000-0000-000000000001', riderUserId: riderId })
      .expect(404);
  });

  it('404 pour un RIDER authentifié', async () => {
    await riderSession
      .post('/booking/bookings/manual')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId: '00000000-0000-0000-0000-000000000001', riderUserId: riderId })
      .expect(404);
  });

  it('404 pour un ADMIN avec bookings.manage', async () => {
    const session = await createTestSession(app);
    await session
      .post('/booking/bookings/manual')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availabilityId: '00000000-0000-0000-0000-000000000001', riderUserId: riderId })
      .expect(404);
  });
});

// ─── 6. createRequest — guard OPEN atomique ───────────────────────────────────

describe('POST /booking/requests — guard OPEN', () => {
  it('refusé si availability CLOSED — 409', async () => {
    const avail = await createAvailability({ capacity: 1 });
    await prisma.proAvailability.update({
      where: { id: avail.id },
      data: { status: 'CLOSED' },
    });

    const res = await riderSession
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId: avail.id, message: 'Cours dispo ?' })
      .expect(409);

    expect(res.body.error).toMatch(/not open/i);
  });

  it('refusé si availability inexistante — 404', async () => {
    const res = await riderSession
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId: '00000000-0000-0000-0000-000000000000', message: 'test' })
      .expect(404);

    expect(res.body.error).toMatch(/not found/i);
  });

  it('refusé si le rider est owner de la disponibilité (self-booking) — 400', async () => {
    // Insérer une availability dont proUserId = riderId (cas artificiel pour tester le guard)
    const fakeAvail = await prisma.proAvailability.create({
      data: {
        proUserId: riderId,
        sport: 'surf',
        levels: ['beginner'],
        startAt: new Date(Date.now() + 4 * 3_600_000),
        endAt:   new Date(Date.now() + 5 * 3_600_000),
        capacity: 1,
        spotName: 'Test Self',
        spotLat: 43.493,
        spotLng: -1.558,
      },
    });

    const res = await riderSession
      .post('/booking/requests')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ availabilityId: fakeAvail.id, message: 'auto-booking' })
      .expect(400);

    expect(res.body.error).toMatch(/own availability/i);
    await prisma.proAvailability.delete({ where: { id: fakeAvail.id } });
  });
});

// ─── 7. adjustBookedCount — restriction ADMIN ────────────────────────────────

describe('PATCH /booking/availability/:id/adjust-booked — restriction', () => {
  it('refusé au PRO — 403', async () => {
    const avail = await createAvailability();
    await proSession
      .patch(`/booking/availability/${avail.id}/adjust-booked`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ delta: -1, reason: 'raison suffisamment longue pour passer' })
      .expect(403);
  });

  it('reason trop courte → 400', async () => {
    const avail = await createAvailability();
    const session = await createTestSession(app);
    await session
      .patch(`/booking/availability/${avail.id}/adjust-booked`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ delta: 0, reason: 'court' })
      .expect(400);
  });
});

// ─── 8. updateAvailability — verrouillage ────────────────────────────────────

describe('PATCH /booking/availability/:id — verrouillage', () => {
  it('bloqué si modification startAt avec booking CONFIRMED actif — 409', async () => {
    const avail = await createAvailability();
    await createConfirmedBooking(avail.id, riderId);

    const res = await proSession
      .patch(`/booking/availability/${avail.id}`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ startAt: new Date(Date.now() + 48 * 3_600_000).toISOString() })
      .expect(409);

    expect(res.body.error).toMatch(/Cannot change schedule/i);
  });

  it('bloqué si capacity réduite sous confirmedCount — 409', async () => {
    const avail = await createAvailability({ capacity: 3 });
    await createConfirmedBooking(avail.id, riderId);
    await createConfirmedBooking(avail.id, rider2Id);

    const res = await proSession
      .patch(`/booking/availability/${avail.id}`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({ capacity: 1 })
      .expect(409);

    expect(res.body.error).toMatch(/Cannot reduce capacity/i);
  });
});
