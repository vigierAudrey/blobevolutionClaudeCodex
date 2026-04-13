/**
 * gdpr-purge-anonymize-booking.test.ts
 *
 * Tests sur la VRAIE méthode GDPRPurgeService.anonymizeDeletedUsers()
 * avec Prisma et archiveBookingsBulk mockés.
 *
 * Cas couverts (P0 du cahier des charges) :
 *   1. P2021 + LIVE → BLOCK — user.delete() non appelé
 *   2. P2021 + DECOMMISSIONED → CONTINUE — user.delete() appelé
 *   3. Erreur non-table + DECOMMISSIONED → BLOCK — user.delete() non appelé
 *   4. Erreur non-table + LIVE → BLOCK
 *   5. Aucun booking → user.delete() appelé normalement (happy path)
 *   6. archiveResult.errors > 0 → BLOCK
 */

import { jest } from '@jest/globals';

// ─── Mocks avant tout import ─────────────────────────────────────────────────

const mockUserFindMany = jest.fn();
const mockLegalConsentArchiveUpsert = jest.fn();
const mockBookingFindMany = jest.fn();
const mockUserDelete = jest.fn();
const mockRiderProfileUpdate = jest.fn();
const mockProProfileUpdate = jest.fn();
const mockUserUpdate = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    user: {
      findMany: mockUserFindMany,
      update: mockUserUpdate,
      delete: mockUserDelete,
    },
    legalConsentArchive: {
      upsert: mockLegalConsentArchiveUpsert,
    },
    booking: {
      findMany: mockBookingFindMany,
    },
    riderProfile: { update: mockRiderProfileUpdate },
    proProfile: { update: mockProProfileUpdate },
  },
  Prisma: {},
}));

const mockArchiveBookingsBulk = jest.fn();
jest.mock('../../lib/booking-archive', () => ({
  archiveBookingsBulk: mockArchiveBookingsBulk,
}));

jest.mock('../../services/retention-export-artifact.service', () => ({
  retentionExportArtifactService: {
    hasVerifiedCoverage: jest.fn(async () => true),
  },
}));

// ─── Import après mocks ──────────────────────────────────────────────────────

import { GDPRPurgeService } from '../gdpr-purge.service';

// ─────────────────────────────────────────────────────────────────────────────

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, NODE_ENV: 'test' };
  delete process.env.BOOKING_DECOMMISSION_STATE;
  delete process.env.BOOKING_DISABLED;
  jest.clearAllMocks();
});

afterAll(() => {
  process.env = originalEnv;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEN_YEARS_AGO = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000 - 1);

const testUser = {
  id: 'user-test-uuid-001',
  email: 'anon_abc123@anonymized.local', // déjà anonymisé (Phase 2)
  deletedAt: TEN_YEARS_AGO,
  consentedAt: new Date('2016-01-01'),
  consentVersion: 'v1',
  consentIpHash: 'sha256hash',
  riderProfile: null,
  proProfile: null,
};

/** Configure findMany pour ne retourner que les utilisateurs Phase 3 (10 ans) */
function setupPhase3Users(users = [testUser]) {
  mockUserFindMany.mockImplementation(async (args: { where?: { deletedAt?: { not: null; lt: Date } }; email?: unknown }) => {
    // Phase 1 (7 jours) et Phase 2 (2 ans) — retournent vide pour simplifier
    if (args?.where?.email) return [];
    // Phase 3 (10 ans) — retourne nos utilisateurs de test
    return users;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cas 1 : P2021 + LIVE → BLOCK
// ─────────────────────────────────────────────────────────────────────────────

describe('Cas 1 : P2021 + LIVE → user.delete() bloqué', () => {
  beforeEach(() => {
    setupPhase3Users();
    mockLegalConsentArchiveUpsert.mockResolvedValue({});
    mockBookingFindMany.mockRejectedValue(
      Object.assign(new Error('table "Booking" does not exist'), { code: 'P2021' }),
    );
  });

  it('ne supprime pas l\'utilisateur quand P2021 sans DECOMMISSIONED', async () => {
    const service = new GDPRPurgeService();
    const result = await service.anonymizeDeletedUsers();

    expect(mockUserDelete).not.toHaveBeenCalled();
    // phase3Count est incrémenté (pour le reporting) mais user.delete non appelé
    expect(result.phase3Purged).toBe(1);
  });

  it('BOOKING_DISABLED=true sans DECOMMISSIONED → toujours BLOCK', async () => {
    process.env.BOOKING_DISABLED = 'true'; // FREEZE_ACTIVE, pas DECOMMISSIONED
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 2 : P2021 + DECOMMISSIONED → CONTINUE
// ─────────────────────────────────────────────────────────────────────────────

describe('Cas 2 : P2021 + DECOMMISSIONED → user.delete() appelé', () => {
  beforeEach(() => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    setupPhase3Users();
    mockLegalConsentArchiveUpsert.mockResolvedValue({});
    mockBookingFindMany.mockRejectedValue(
      Object.assign(new Error('table "Booking" does not exist'), { code: 'P2021' }),
    );
    mockUserDelete.mockResolvedValue({});
  });

  it('supprime l\'utilisateur quand P2021 + DECOMMISSIONED', async () => {
    const service = new GDPRPurgeService();
    const result = await service.anonymizeDeletedUsers();

    expect(mockUserDelete).toHaveBeenCalledTimes(1);
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: testUser.id } });
    expect(result.phase3Purged).toBe(1);
  });

  it('P2022 + DECOMMISSIONED → également CONTINUE (colonne absente = même sémantique)', async () => {
    mockBookingFindMany.mockRejectedValue(
      Object.assign(new Error('column does not exist'), { code: 'P2022' }),
    );
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).toHaveBeenCalledTimes(1);
  });

  it('42P01 dans message + DECOMMISSIONED → CONTINUE', async () => {
    mockBookingFindMany.mockRejectedValue(
      new Error('ERROR: 42P01: relation "Booking" does not exist'),
    );
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).toHaveBeenCalledTimes(1);
  });

  it('ne fait pas d\'archivage booking quand table absente (P2021)', async () => {
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockArchiveBookingsBulk).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 3 : Erreur non-table + DECOMMISSIONED → BLOCK
// ─────────────────────────────────────────────────────────────────────────────

describe('Cas 3 : erreur non-table + DECOMMISSIONED → user.delete() bloqué', () => {
  beforeEach(() => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    setupPhase3Users();
    mockLegalConsentArchiveUpsert.mockResolvedValue({});
  });

  it('erreur réseau → BLOCK même en DECOMMISSIONED', async () => {
    mockBookingFindMany.mockRejectedValue(new Error('Connection refused'));
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it('P2002 (contrainte unique) → BLOCK', async () => {
    mockBookingFindMany.mockRejectedValue(
      Object.assign(new Error('unique constraint failed'), { code: 'P2002' }),
    );
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 4 : Erreur non-table + LIVE → BLOCK
// ─────────────────────────────────────────────────────────────────────────────

describe('Cas 4 : erreur non-table + LIVE → BLOCK', () => {
  beforeEach(() => {
    setupPhase3Users();
    mockLegalConsentArchiveUpsert.mockResolvedValue({});
    mockBookingFindMany.mockRejectedValue(new Error('DB timeout'));
  });

  it('timeout DB → user.delete() non appelé', async () => {
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 5 : Aucun booking → happy path
// ─────────────────────────────────────────────────────────────────────────────

describe('Cas 5 : aucun booking → user.delete() appelé sans archivage', () => {
  beforeEach(() => {
    setupPhase3Users();
    mockLegalConsentArchiveUpsert.mockResolvedValue({});
    mockBookingFindMany.mockResolvedValue([]); // aucun booking à archiver
    mockUserDelete.mockResolvedValue({});
  });

  it('supprime l\'utilisateur directement quand aucun booking', async () => {
    const service = new GDPRPurgeService();
    const result = await service.anonymizeDeletedUsers();

    expect(mockUserDelete).toHaveBeenCalledTimes(1);
    expect(mockArchiveBookingsBulk).not.toHaveBeenCalled();
    expect(result.phase3Purged).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 6 : archiveResult.errors > 0 → BLOCK
// ─────────────────────────────────────────────────────────────────────────────

describe('Cas 6 : erreur d\'archivage → user.delete() bloqué', () => {
  const bookingWithAvail = {
    id: 'booking-001',
    riderUserId: testUser.id,
    availabilityId: 'avail-001',
    status: 'CONFIRMED',
    createdAt: new Date(),
    availability: { proUserId: 'pro-001', sport: 'SKI', startAt: new Date(), price: null },
  };

  beforeEach(() => {
    setupPhase3Users();
    mockLegalConsentArchiveUpsert.mockResolvedValue({});
    mockBookingFindMany.mockResolvedValue([bookingWithAvail]);
    mockArchiveBookingsBulk.mockResolvedValue({ created: 0, skipped: 0, errors: 1 }); // erreur archivage
    mockUserDelete.mockResolvedValue({});
  });

  it('ne supprime pas l\'utilisateur si archivage en erreur', async () => {
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it('user.delete() appelé si archivage réussit (control test)', async () => {
    mockArchiveBookingsBulk.mockResolvedValue({ created: 1, skipped: 0, errors: 0 }); // succès
    const service = new GDPRPurgeService();
    await service.anonymizeDeletedUsers();
    expect(mockUserDelete).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas 7 : Aucun utilisateur Phase 3 → aucune action
// ─────────────────────────────────────────────────────────────────────────────

describe('Cas 7 : aucun utilisateur Phase 3', () => {
  beforeEach(() => {
    mockUserFindMany.mockResolvedValue([]);
  });

  it('ne fait rien et retourne 0', async () => {
    const service = new GDPRPurgeService();
    const result = await service.anonymizeDeletedUsers();
    expect(result.phase3Purged).toBe(0);
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockBookingFindMany).not.toHaveBeenCalled();
  });
});
