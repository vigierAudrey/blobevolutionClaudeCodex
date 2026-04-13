/**
 * reports.snapshot.decommission.test.ts
 *
 * Tests unitaires de la logique snapshot dans analyticsReportService.
 * Prisma mocké — aucune DB requise.
 *
 * Vérifie :
 *   A. frozen=true → aucune lecture live (prisma.bookingRequest, prisma.proAvailability jamais appelés)
 *   B. snapshot=null après bascule DECOMMISSIONED → erreur explicite (pas de fallback live)
 *   C. snapshot=null avant bascule (LIVE) → fallback live acceptable
 *   D. snapshot table absente (throw) en FREEZE_ACTIVE → erreur explicite
 *   E. snapshot table absente (throw) en LIVE → fallback live (aucune erreur)
 */

import { jest } from '@jest/globals';

// ─── Mock Prisma avant import du service ────────────────────────────────────
const mockFindUnique = jest.fn();
const mockBookingRequestGroupBy = jest.fn();
const mockBookingRequestFindMany = jest.fn();
const mockProAvailabilityFindMany = jest.fn();
const mockUserFindMany = jest.fn();
const mockMessageGroupBy = jest.fn();
const mockMatchDecisionGroupBy = jest.fn();
const mockProProfileFindMany = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    bookingAnalyticsSnapshot: { findUnique: mockFindUnique },
    bookingRequest: {
      groupBy: mockBookingRequestGroupBy,
      findMany: mockBookingRequestFindMany,
    },
    proAvailability: { findMany: mockProAvailabilityFindMany },
    user: { findMany: mockUserFindMany },
    message: { groupBy: mockMessageGroupBy },
    matchDecision: { groupBy: mockMatchDecisionGroupBy },
    proProfile: { findMany: mockProProfileFindMany },
  },
}));

// ─── Mock blobosphere (non concerné par ces tests) ──────────────────────────
jest.mock('../../blobosphere-content.service', () => ({
  loadPublishedBlobosphereArticles: jest.fn(async () => []),
}));

import { analyticsReportService } from '../reports.service';

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

// ── Fixture snapshot gelé ────────────────────────────────────────────────────

const frozenSnapshot = {
  period: '30d',
  frozen: true,
  snapshotAt: new Date('2026-04-01T00:00:00Z'),
  ttfvRiderSampleSize: 42,
  ttfvRiderMedianMin: 15.5,
  ttfvRiderP90Min: 87.3,
  ttfvRiderMasked: false,
  ttfvProSampleSize: 18,
  ttfvProMedianMin: 30.0,
  ttfvProP90Min: 120.0,
  ttfvProMasked: false,
  marketplaceJson: {
    supplyDemand: [],
    acceptance: { totalRequests: 100, masked: false },
    acceptanceBySport: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// A. frozen=true → zéro lecture live
// ─────────────────────────────────────────────────────────────────────────────

describe('A. frozen=true → zéro lecture live', () => {
  it('getTtfv: retourne données snapshot et ne lit PAS bookingRequest ni proAvailability', async () => {
    mockFindUnique.mockResolvedValue(frozenSnapshot);

    const result = await analyticsReportService.getTtfv('30d');

    // Vérifie les données snapshot
    expect(result.riders.sampleSize).toBe(42);
    expect(result.riders.medianMinutes).toBe(15.5);
    expect(result.pros.sampleSize).toBe(18);
    expect((result as { frozenAt?: string }).frozenAt).toBe('2026-04-01T00:00:00.000Z');

    // Preuve absolue : aucune lecture live
    expect(mockBookingRequestGroupBy).not.toHaveBeenCalled();
    expect(mockBookingRequestFindMany).not.toHaveBeenCalled();
    expect(mockProAvailabilityFindMany).not.toHaveBeenCalled();
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockMessageGroupBy).not.toHaveBeenCalled();
    expect(mockMatchDecisionGroupBy).not.toHaveBeenCalled();
    expect(mockProProfileFindMany).not.toHaveBeenCalled();
  });

  it('getMarketplaceHealth: retourne données snapshot et ne lit PAS bookingRequest ni proAvailability', async () => {
    mockFindUnique.mockResolvedValue(frozenSnapshot);

    const result = await analyticsReportService.getMarketplaceHealth('30d');

    expect((result as { frozenAt?: string }).frozenAt).toBe('2026-04-01T00:00:00.000Z');
    expect((result as { dataNote?: string }).dataNote).toMatch(/gelées/);

    // Preuve absolue : aucune lecture live
    expect(mockBookingRequestFindMany).not.toHaveBeenCalled();
    expect(mockProAvailabilityFindMany).not.toHaveBeenCalled();
  });

  it('getTtfv: findUnique appelé UNE SEULE FOIS (pas de double requête)', async () => {
    mockFindUnique.mockResolvedValue(frozenSnapshot);
    await analyticsReportService.getTtfv('30d');
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { period: '30d' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. snapshot=null après bascule DECOMMISSIONED → erreur explicite, pas de fallback live
// ─────────────────────────────────────────────────────────────────────────────

describe('B. snapshot=null + DECOMMISSIONED → erreur explicite', () => {
  beforeEach(() => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    mockFindUnique.mockResolvedValue(null); // snapshot absent
  });

  it('getTtfv: throw ANALYTICS_SNAPSHOT_MISSING_AFTER_DECOMMISSION', async () => {
    await expect(analyticsReportService.getTtfv('30d')).rejects.toThrow(
      'ANALYTICS_SNAPSHOT_MISSING_AFTER_DECOMMISSION',
    );
    // Aucune tentative de lecture live
    expect(mockBookingRequestGroupBy).not.toHaveBeenCalled();
    expect(mockBookingRequestFindMany).not.toHaveBeenCalled();
    expect(mockProAvailabilityFindMany).not.toHaveBeenCalled();
  });

  it('getMarketplaceHealth: throw ANALYTICS_SNAPSHOT_MISSING_AFTER_DECOMMISSION', async () => {
    await expect(analyticsReportService.getMarketplaceHealth('30d')).rejects.toThrow(
      'ANALYTICS_SNAPSHOT_MISSING_AFTER_DECOMMISSION',
    );
    expect(mockBookingRequestFindMany).not.toHaveBeenCalled();
    expect(mockProAvailabilityFindMany).not.toHaveBeenCalled();
  });

  it('getTtfv: snapshot frozen=false + DECOMMISSIONED → erreur explicite (non gelé = incohérent)', async () => {
    mockFindUnique.mockResolvedValue({ ...frozenSnapshot, frozen: false });
    await expect(analyticsReportService.getTtfv('30d')).rejects.toThrow(
      'ANALYTICS_SNAPSHOT_MISSING_AFTER_DECOMMISSION',
    );
    expect(mockBookingRequestGroupBy).not.toHaveBeenCalled();
  });

  it('message d\'erreur contient la période pour faciliter le diagnostic', async () => {
    await expect(analyticsReportService.getTtfv('7d')).rejects.toThrow('period=7d');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. snapshot=null avant bascule (LIVE) → fallback live acceptable
// ─────────────────────────────────────────────────────────────────────────────

describe('C. snapshot=null + LIVE → fallback live acceptable', () => {
  beforeEach(() => {
    // Phase LIVE : NODE_ENV=test, sans BOOKING_DISABLED ni BOOKING_DECOMMISSION_STATE
    mockFindUnique.mockResolvedValue(null);
    // Mocks live minimaux pour que le fallback ne crashe pas
    mockUserFindMany.mockResolvedValue([]);
    mockBookingRequestGroupBy.mockResolvedValue([]);
    mockBookingRequestFindMany.mockResolvedValue([]);
    mockProAvailabilityFindMany.mockResolvedValue([]);
    mockMessageGroupBy.mockResolvedValue([]);
    mockMatchDecisionGroupBy.mockResolvedValue([]);
    mockProProfileFindMany.mockResolvedValue([]);
  });

  it('getTtfv: ne throw pas, tente le calcul live', async () => {
    await expect(analyticsReportService.getTtfv('30d')).resolves.toBeDefined();
  });

  it('getMarketplaceHealth: ne throw pas, tente le calcul live', async () => {
    await expect(analyticsReportService.getMarketplaceHealth('30d')).resolves.toBeDefined();
  });

  it('getTtfv: résultat live contient riders et pros (pas de frozenAt)', async () => {
    const result = await analyticsReportService.getTtfv('30d');
    expect((result as { frozenAt?: string }).frozenAt).toBeUndefined();
    expect(result).toHaveProperty('riders');
    expect(result).toHaveProperty('pros');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Table snapshot absente (throw) en FREEZE_ACTIVE → erreur explicite
// ─────────────────────────────────────────────────────────────────────────────

describe('D. table snapshot absente + FREEZE_ACTIVE → erreur explicite', () => {
  beforeEach(() => {
    process.env.BOOKING_DISABLED = 'true'; // FREEZE_ACTIVE
    mockFindUnique.mockRejectedValue(Object.assign(new Error('table not found'), { code: 'P2021' }));
  });

  it('getTtfv: throw ANALYTICS_SNAPSHOT_TABLE_MISSING', async () => {
    await expect(analyticsReportService.getTtfv('30d')).rejects.toThrow(
      'ANALYTICS_SNAPSHOT_TABLE_MISSING',
    );
  });

  it('getMarketplaceHealth: throw ANALYTICS_SNAPSHOT_TABLE_MISSING', async () => {
    await expect(analyticsReportService.getMarketplaceHealth('30d')).rejects.toThrow(
      'ANALYTICS_SNAPSHOT_TABLE_MISSING',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Table snapshot absente (throw) en LIVE → fallback live (aucune erreur)
// ─────────────────────────────────────────────────────────────────────────────

describe('E. table snapshot absente + LIVE → fallback live acceptable', () => {
  beforeEach(() => {
    // Phase LIVE : test env sans variables booking
    mockFindUnique.mockRejectedValue(Object.assign(new Error('table not found'), { code: 'P2021' }));
    // Mocks live minimaux
    mockUserFindMany.mockResolvedValue([]);
    mockBookingRequestGroupBy.mockResolvedValue([]);
    mockBookingRequestFindMany.mockResolvedValue([]);
    mockProAvailabilityFindMany.mockResolvedValue([]);
    mockMessageGroupBy.mockResolvedValue([]);
    mockMatchDecisionGroupBy.mockResolvedValue([]);
    mockProProfileFindMany.mockResolvedValue([]);
  });

  it('getTtfv: ne throw pas (table snapshot absente acceptable en LIVE)', async () => {
    await expect(analyticsReportService.getTtfv('30d')).resolves.toBeDefined();
  });

  it('getMarketplaceHealth: ne throw pas (table snapshot absente acceptable en LIVE)', async () => {
    await expect(analyticsReportService.getMarketplaceHealth('30d')).resolves.toBeDefined();
  });
});
