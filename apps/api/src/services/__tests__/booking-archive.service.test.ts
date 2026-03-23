/**
 * Tests du BookingArchiveService — job d'archivage des bookings passés.
 *
 * Pattern : DB réelle, beforeEach cleanup ciblé.
 * Les fixtures sont créées via Prisma direct (pas via le service booking)
 * pour éviter les dépendances aux validations métier (geo, quota).
 */

import { clientPrisma as prisma, Role, Sport } from '@blobinfini/database';
import { createUser } from '../../tests/helpers/prismaFactories';
import {
  bookingArchiveService,
  DEFAULT_GRACE_DAYS,
} from '../booking-archive.service';
import * as archiveLib from '../../lib/booking-archive';

// ─────────────────────────────────────────────────────────────────────────────
// Isolation
// ─────────────────────────────────────────────────────────────────────────────

const TEST_TAG = 'bas-test'; // booking-archive-service

async function cleanupTestData() {
  await prisma.bookingLegalArchive.deleteMany({
    where: { bookingId: { startsWith: TEST_TAG } },
  });
  await prisma.booking.deleteMany({
    where: { availability: { spotName: TEST_TAG } },
  });
  await prisma.proAvailability.deleteMany({
    where: { spotName: TEST_TAG },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: `${TEST_TAG}@` } },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crée un booking complet (rider + pro + availability + booking).
 * @param suffix  suffixe unique pour l'email et les timestamps
 * @param endAt   date de fin de l'availability
 */
async function seedBooking(suffix: string, endAt: Date) {
  const startAt = new Date(endAt.getTime() - 2 * 60 * 60 * 1000); // endAt - 2h

  const rider = await createUser(prisma, {
    email: `${TEST_TAG}-rider-${suffix}@test.local`,
    role: Role.RIDER,
  });
  const pro = await createUser(prisma, {
    email: `${TEST_TAG}-pro-${suffix}@test.local`,
    role: Role.PRO,
  });

  const availability = await prisma.proAvailability.create({
    data: {
      proUserId: pro.id,
      sport: Sport.surf,
      levels: ['beginner'],
      startAt,
      endAt,
      capacity: 1,
      spotName: TEST_TAG,
      price: 60,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      riderUserId: rider.id,
      availabilityId: availability.id,
      status: 'CONFIRMED',
    },
  });

  return { booking, availability, rider, pro };
}

/**
 * Date de fin située dans le passé lointain (hors grace period).
 * endAt = now - (DEFAULT_GRACE_DAYS + 6) jours
 */
function pastEndAt(extraDays = 6): Date {
  return new Date(Date.now() - (DEFAULT_GRACE_DAYS + extraDays) * 24 * 60 * 60 * 1000);
}

/**
 * Date de fin dans la grace period (non éligible à l'archivage).
 * endAt = now - (DEFAULT_GRACE_DAYS - 7) jours
 */
function recentEndAt(): Date {
  return new Date(Date.now() - (DEFAULT_GRACE_DAYS - 7) * 24 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite principale
// ─────────────────────────────────────────────────────────────────────────────

describe('BookingArchiveService — archiveClosedBookings', () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('archive un booking dont endAt dépasse la grace period', async () => {
    const { booking, availability } = await seedBooking('t1', pastEndAt());

    const result = await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);

    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.created).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(0);

    const archive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: booking.id },
    });
    expect(archive).not.toBeNull();
    expect(archive!.finalStatus).toBe('CONFIRMED');
    // closedAt = availability.endAt (fenêtre planifiée, pas preuve d'exécution)
    expect(archive!.closedAt.getTime()).toBe(availability.endAt.getTime());
    expect(archive!.sport).toBe(Sport.surf);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("n'archive PAS un booking dont endAt est dans la grace period", async () => {
    const { booking } = await seedBooking('t2', recentEndAt());

    const result = await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);

    // Ce booking ne doit pas apparaître dans les résultats (hors cutoff)
    const archive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: booking.id },
    });
    expect(archive).toBeNull();

    // Le booking récent ne doit pas être dans created
    // (scanned peut inclure d'autres bookings de tests précédents — on vérifie l'archive)
    expect(result.errors).toBe(0);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('retourne skipped pour un booking déjà archivé — pas de doublon', async () => {
    const { booking } = await seedBooking('t3', pastEndAt());

    // Premier passage
    await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);
    const countAfterFirst = await prisma.bookingLegalArchive.count({
      where: { bookingId: booking.id },
    });
    expect(countAfterFirst).toBe(1);

    // Second passage
    const result = await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);

    // Toujours un seul enregistrement
    const countAfterSecond = await prisma.bookingLegalArchive.count({
      where: { bookingId: booking.id },
    });
    expect(countAfterSecond).toBe(1);
    expect(result.errors).toBe(0);
    // Ce booking doit être compté skipped (pas created)
    expect(result.created).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("une erreur sur un item n'interrompt pas le batch — les autres sont archivés", async () => {
    const { booking: goodBooking } = await seedBooking('t4a', pastEndAt(7));
    const { booking: badBooking }  = await seedBooking('t4b', pastEndAt(8));

    // Forcer une erreur sur le "bad" booking uniquement.
    // On sauvegarde l'original avant de patcher pour éviter la récursion.
    const originalFn = archiveLib.archiveBookingIfNotExists;
    const spy = jest.spyOn(archiveLib, 'archiveBookingIfNotExists').mockImplementation(
      async (b, closedAt) => {
        if (b.id === badBooking.id) throw new Error('DB failure simulée');
        return originalFn(b, closedAt);
      },
    );

    let result;
    try {
      result = await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);
    } finally {
      spy.mockRestore();
    }

    expect(result!.errors).toBeGreaterThanOrEqual(1);
    // Le booking sain doit avoir été archivé malgré l'erreur sur l'autre
    const goodArchive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: goodBooking.id },
    });
    expect(goodArchive).not.toBeNull();
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('le résumé final contient des compteurs cohérents (scanned >= created + skipped + errors)', async () => {
    // Deux bookings passés + un dans la grace period
    await seedBooking('t5a', pastEndAt(6));
    await seedBooking('t5b', pastEndAt(8));
    await seedBooking('t5c', recentEndAt());  // hors scope

    const result = await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);

    // Invariant de cohérence
    expect(result.scanned).toBeGreaterThanOrEqual(result.created + result.skipped + result.errors);
    // Les deux passés doivent être archivés
    expect(result.created).toBeGreaterThanOrEqual(2);
    expect(result.errors).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("l'archive ne contient aucun userId en clair (PII exclues)", async () => {
    const { booking, rider, pro } = await seedBooking('t6', pastEndAt());

    await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);

    const archive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: booking.id },
    });
    expect(archive).not.toBeNull();

    const json = JSON.stringify(archive);
    expect(json).not.toContain(rider.id);
    expect(json).not.toContain(pro.id);
    // Les hashes sont présents et bien formés
    expect(archive!.riderHash).toMatch(/^[0-9a-f]{64}$/);
    expect(archive!.proHash).toMatch(/^[0-9a-f]{64}$/);
    expect(archive!.riderHash).not.toBe(archive!.proHash);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('closedAt est bien égal à availability.endAt (caveat documenté)', async () => {
    const endAt = pastEndAt(10);
    const { booking, availability } = await seedBooking('t7', endAt);

    await bookingArchiveService.archiveClosedBookings(DEFAULT_GRACE_DAYS);

    const archive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: booking.id },
    });
    expect(archive).not.toBeNull();
    // closedAt = fenêtre planifiée, pas preuve d'exécution
    expect(archive!.closedAt.getTime()).toBe(availability.endAt.getTime());
  });
});
