/**
 * booking-legal-archive.test.ts
 *
 * Tests de la Phase 1 RGPD :
 *   1. archiveBookingIfNotExists → archive créée
 *   2. Re-run → skipped (idempotence)
 *   3. archiveBookingsBulk → plusieurs bookings
 *   4. backfill skip les déjà archivés
 *   5. archive ne contient aucune PII directe (userId en clair)
 *   6. hashUserIdForArchive est stable et non réversible
 *   7. purgeRelationalData utilise bien 90 jours (pas 30)
 *
 * Pattern : DB réelle, beforeEach cleanup ciblé.
 */

import { clientPrisma as prisma, Role, Sport } from '@blobinfini/database';
import { createUser } from '../../../tests/helpers/prismaFactories';
import {
  archiveBookingIfNotExists,
  archiveBookingsBulk,
  hashUserIdForArchive,
  type BookingForArchive,
} from '../../../lib/booking-archive';
import { gdprPurgeService } from '../../../services/gdpr-purge.service';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de fixture
// ─────────────────────────────────────────────────────────────────────────────

const TEST_TAG = 'bla-test'; // préfixe pour isolation

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
  await prisma.conversationMember.deleteMany({
    where: { conversation: { directKey: { startsWith: TEST_TAG } } },
  });
  await prisma.conversation.deleteMany({
    where: { directKey: { startsWith: TEST_TAG } },
  });
}

/**
 * Crée un booking réel en DB avec rider + pro + availability.
 * Retourne un objet shape BookingForArchive utilisable directement.
 */
async function seedBooking(suffix: string): Promise<{
  booking: BookingForArchive;
  riderUserId: string;
  proUserId: string;
}> {
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
      startAt: new Date('2026-06-01T10:00:00Z'),
      endAt: new Date('2026-06-01T12:00:00Z'),
      capacity: 1,
      spotName: TEST_TAG,
      price: 50,
    },
  });

  const raw = await prisma.booking.create({
    data: {
      riderUserId: rider.id,
      availabilityId: availability.id,
      status: 'CONFIRMED',
    },
    include: {
      availability: {
        select: { proUserId: true, sport: true, startAt: true, price: true },
      },
    },
  });

  return {
    booking: raw as unknown as BookingForArchive,
    riderUserId: rider.id,
    proUserId: pro.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite principale
// ─────────────────────────────────────────────────────────────────────────────

describe('BookingLegalArchive — Phase 1 RGPD', () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('archiveBookingIfNotExists crée une archive pour un booking non archivé', async () => {
    const { booking } = await seedBooking('t1');
    const closedAt = new Date();

    const result = await archiveBookingIfNotExists(booking, closedAt);

    expect(result).toBe('created');

    const archive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: booking.id },
    });

    expect(archive).not.toBeNull();
    expect(archive!.bookingId).toBe(booking.id);
    expect(archive!.finalStatus).toBe('CONFIRMED');
    expect(archive!.sport).toBe(Sport.surf);
    expect(archive!.purgeAt.getTime()).toBeGreaterThan(
      archive!.archivedAt.getTime()
    );
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('archiveBookingIfNotExists est idempotent — retourne skipped au 2ème appel', async () => {
    const { booking } = await seedBooking('t2');
    const closedAt = new Date();

    const first = await archiveBookingIfNotExists(booking, closedAt);
    const second = await archiveBookingIfNotExists(booking, closedAt);

    expect(first).toBe('created');
    expect(second).toBe('skipped');

    // Un seul enregistrement en base
    const count = await prisma.bookingLegalArchive.count({
      where: { bookingId: booking.id },
    });
    expect(count).toBe(1);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('archiveBookingsBulk archive plusieurs bookings et retourne les compteurs corrects', async () => {
    const { booking: b1 } = await seedBooking('t3a');
    const { booking: b2 } = await seedBooking('t3b');
    const closedAt = new Date();

    const result = await archiveBookingsBulk([b1, b2], closedAt, 'test');

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('archiveBookingsBulk skip les bookings déjà archivés (backfill idempotent)', async () => {
    const { booking } = await seedBooking('t4');
    const closedAt = new Date();

    // Premier passage : crée
    await archiveBookingIfNotExists(booking, closedAt);

    // Deuxième passage (simule un backfill rejoué)
    const result = await archiveBookingsBulk([booking], closedAt, 'test-backfill');

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("l'archive ne contient aucune PII directe (userId en clair absent)", async () => {
    const { booking, riderUserId, proUserId } = await seedBooking('t5');
    const closedAt = new Date();

    await archiveBookingIfNotExists(booking, closedAt);

    const archive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: booking.id },
    });
    expect(archive).not.toBeNull();

    // Convertit l'archive en string JSON pour vérifier l'absence des IDs directs
    const archiveJson = JSON.stringify(archive);

    expect(archiveJson).not.toContain(riderUserId);
    expect(archiveJson).not.toContain(proUserId);

    // Les hashes sont présents et non vides
    expect(archive!.riderHash.length).toBe(64); // SHA-256 hex = 64 chars
    expect(archive!.proHash.length).toBe(64);
    expect(archive!.riderHash).not.toBe(archive!.proHash); // rider ≠ pro
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('hashUserIdForArchive est stable (même input → même output) et non réversible', () => {
    const userId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    const h1 = hashUserIdForArchive(userId);
    const h2 = hashUserIdForArchive(userId);

    // Stabilité : deux appels identiques → même hash
    expect(h1).toBe(h2);

    // Format : SHA-256 hex = exactement 64 caractères
    expect(h1).toMatch(/^[0-9a-f]{64}$/);

    // Non réversible : le userId ne doit pas apparaître dans le hash
    expect(h1).not.toContain(userId);

    // Deux userId différents → deux hashes différents
    const h3 = hashUserIdForArchive('different-user-id');
    expect(h1).not.toBe(h3);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('purgeRelationalData utilise 90 jours — ne supprime pas les conversations trashées depuis 60 jours', async () => {
    // Crée une conversation trashée depuis 60 jours (< 90 → ne doit PAS être supprimée)
    const user = await createUser(prisma, {
      email: `${TEST_TAG}-conv-60d@test.local`,
    });

    const conv = await prisma.conversation.create({
      data: { directKey: `${TEST_TAG}-conv-60d`, type: 'RIDER_TO_RIDER' },
    });

    const trashedAt60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    await prisma.conversationMember.create({
      data: {
        conversationId: conv.id,
        userId: user.id,
        trashedAt: trashedAt60,
      },
    });

    // Run purge
    await gdprPurgeService.purgeRelationalData();

    // La conversation doit TOUJOURS exister (60j < 90j)
    const memberAfter = await prisma.conversationMember.findFirst({
      where: { conversationId: conv.id, userId: user.id },
    });
    expect(memberAfter).not.toBeNull();
  });

  // ── Test 7b ─────────────────────────────────────────────────────────────────
  it('purgeRelationalData supprime les conversations trashées depuis 100 jours (> 90)', async () => {
    const user = await createUser(prisma, {
      email: `${TEST_TAG}-conv-100d@test.local`,
    });

    const conv = await prisma.conversation.create({
      data: { directKey: `${TEST_TAG}-conv-100d`, type: 'RIDER_TO_RIDER' },
    });

    const trashedAt100 = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await prisma.conversationMember.create({
      data: {
        conversationId: conv.id,
        userId: user.id,
        trashedAt: trashedAt100,
      },
    });

    await gdprPurgeService.purgeRelationalData();

    // Le membre doit avoir été supprimé (100j > 90j)
    const memberAfter = await prisma.conversationMember.findFirst({
      where: { conversationId: conv.id, userId: user.id },
    });
    expect(memberAfter).toBeNull();
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('purgeAt est bien dans ~10 ans à partir de archivedAt', async () => {
    const { booking } = await seedBooking('t8');
    const before = new Date();

    await archiveBookingIfNotExists(booking, new Date());

    const archive = await prisma.bookingLegalArchive.findUnique({
      where: { bookingId: booking.id },
    });
    expect(archive).not.toBeNull();

    const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000;
    const diff = archive!.purgeAt.getTime() - archive!.archivedAt.getTime();

    // Tolérance de +5j pour les années bissextiles (10 ans calendaires ≠ 10 * 365j)
    // 2026-2036 contient 3 années bissextiles (2028, 2032, 2036) → +3j max vs 365j/an
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    expect(diff).toBeGreaterThanOrEqual(tenYearsMs);
    expect(diff).toBeLessThanOrEqual(tenYearsMs + fiveDaysMs);
  });
});
