/**
 * Tests unitaires — lesson-fanout.repository.ts
 *
 * Valide :
 *   - hashRiderRef : non-réversible, longueur 24, déterministe
 *   - makeLessonRequestId : déterministe par rider-jour, distinct rider-à-rider
 *   - recordFanout : appelle prisma.lessonFanout.create avec les bons champs (y/c triggerReason)
 *   - getLessonPerformanceMetrics : calculs corrects sur la ligne agrégée
 *   - matchRate : calcul correct + null quand aucune donnée
 *   - avgProsFound : null en base → 0
 *   - Cas zéro : aucun fanout → valeurs cohérentes
 *   - notificationSuccessRate : formule + cas aucune tentative → null
 *   - Conversions bigint → number
 *   - uniqueRiders7d : COUNT DISTINCT riderRef (pas lessonRequestId)
 *   - bySport : agrégats surf / kitesurf / other
 *
 * Règle mock : chaque test qui appelle getLessonPerformanceMetrics
 * configure explicitement les DEUX mockResolvedValueOnce (main + sport).
 * Ne pas appeler jest.clearAllMocks() à l'intérieur des tests — le
 * beforeEach s'en charge, et clearAllMocks ne vide pas la queue
 * mockResolvedValueOnce (seul mockReset le fait).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  hashRiderRef,
  makeLessonRequestId,
  recordFanout,
  getLessonPerformanceMetrics,
  type FanoutRecord,
} from '../lesson-fanout.repository';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockQueryRaw = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    lessonFanout: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
  Prisma: {
    sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings,
      values,
      __prismaRawSql: true,
    })),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAggRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    requestsToday: BigInt(2),
    requests7d: BigInt(10),
    uniqueRiders7d: BigInt(7),
    prosNotifiedToday: BigInt(8),
    prosNotified7d: BigInt(45),
    avgProsPerRequest: 4.5,
    avgProsFound: 6.0,
    noMatchRequests: BigInt(1),
    matchRate: 90.0,
    notificationFailures: BigInt(3),
    ...overrides,
  };
}

function makeSportRows() {
  return [
    { sport: 'surf',     requests7d: BigInt(6), matchRate: 92.0, avgProsFound: 7.0 },
    { sport: 'kitesurf', requests7d: BigInt(3), matchRate: 85.0, avgProsFound: 4.5 },
    { sport: 'other',    requests7d: BigInt(1), matchRate: null, avgProsFound: null },
  ];
}

/** Configure les deux appels $queryRaw (main agg + sport) pour un test. */
function setupMetricsMocks(
  aggOverrides: Partial<Record<string, unknown>> = {},
  sportRows: unknown[] = makeSportRows(),
) {
  mockQueryRaw
    .mockResolvedValueOnce([makeAggRow(aggOverrides)] as never)
    .mockResolvedValueOnce(sportRows as never);
}

// ─── Tests hashRiderRef ───────────────────────────────────────────────────────

describe('hashRiderRef', () => {
  it('returns a 24-char hex string', () => {
    expect(hashRiderRef('user-123')).toHaveLength(24);
    expect(hashRiderRef('user-123')).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(hashRiderRef('user-abc')).toBe(hashRiderRef('user-abc'));
  });

  it('produces distinct values for distinct inputs', () => {
    expect(hashRiderRef('user-1')).not.toBe(hashRiderRef('user-2'));
  });

  it('does not contain the original riderId', () => {
    const ref = hashRiderRef('secret-rider-id-xyz');
    expect(ref).not.toContain('secret-rider-id-xyz');
  });
});

// ─── Tests makeLessonRequestId ────────────────────────────────────────────────

describe('makeLessonRequestId', () => {
  it('returns a 16-char hex string', () => {
    const id = makeLessonRequestId('rider-x');
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for the same rider on the same day', () => {
    expect(makeLessonRequestId('rider-x')).toBe(makeLessonRequestId('rider-x'));
  });

  it('produces distinct values for distinct riders (same day)', () => {
    expect(makeLessonRequestId('rider-1')).not.toBe(makeLessonRequestId('rider-2'));
  });

  it('is distinct from hashRiderRef (different hash inputs)', () => {
    expect(makeLessonRequestId('rider-x')).not.toBe(hashRiderRef('rider-x'));
  });

  it('does not contain the riderId', () => {
    expect(makeLessonRequestId('my-rider-id')).not.toContain('my-rider-id');
  });
});

// ─── Tests recordFanout ───────────────────────────────────────────────────────

describe('recordFanout', () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue({ id: 'clx123' } as never);
  });

  it('calls prisma.lessonFanout.create with all fields including lessonRequestId and triggerReason', async () => {
    const record: FanoutRecord = {
      riderRef: 'abc123',
      lessonRequestId: 'lid-abc-2026',
      sport: 'surf',
      prosFound: 5,
      prosNotified: 4,
      failureCount: 1,
      triggerReason: 'ACTIVATED',
    };
    await recordFanout(record);
    expect(mockCreate).toHaveBeenCalledWith({ data: record });
  });

  it('accepts null triggerReason (legacy rows)', async () => {
    const record: FanoutRecord = {
      riderRef: 'abc123',
      lessonRequestId: 'lid-abc-legacy',
      sport: 'kitesurf',
      prosFound: 2,
      prosNotified: 2,
      failureCount: 0,
      triggerReason: null,
    };
    await recordFanout(record);
    expect(mockCreate).toHaveBeenCalledWith({ data: record });
  });

  it('propagates DB errors', async () => {
    mockCreate.mockRejectedValue(new Error('DB down') as never);
    await expect(
      recordFanout({ riderRef: 'x', lessonRequestId: 'lid', sport: null, prosFound: 0, prosNotified: 0, failureCount: 0, triggerReason: null }),
    ).rejects.toThrow('DB down');
  });
});

// ─── Tests getLessonPerformanceMetrics ────────────────────────────────────────

describe('getLessonPerformanceMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('converts bigint fields to number', async () => {
    setupMetricsMocks();
    const m = await getLessonPerformanceMetrics();
    expect(typeof m.requestsToday).toBe('number');
    expect(typeof m.requests7d).toBe('number');
    expect(typeof m.uniqueRiders7d).toBe('number');
    expect(typeof m.prosNotifiedToday).toBe('number');
    expect(typeof m.prosNotified7d).toBe('number');
    expect(typeof m.noMatchRequests).toBe('number');
    expect(typeof m.notificationFailures).toBe('number');
  });

  it('maps aggregate row to correct values', async () => {
    setupMetricsMocks();
    const m = await getLessonPerformanceMetrics();
    expect(m.requestsToday).toBe(2);
    expect(m.requests7d).toBe(10);
    expect(m.uniqueRiders7d).toBe(7);
    expect(m.prosNotifiedToday).toBe(8);
    expect(m.prosNotified7d).toBe(45);
    expect(m.avgProsPerRequest).toBe(4.5);
    expect(m.avgProsFound).toBe(6.0);
    expect(m.noMatchRequests).toBe(1);
    expect(m.matchRate).toBe(90.0);
    expect(m.notificationFailures).toBe(3);
  });

  it('calculates notificationSuccessRate correctly (45 notified + 3 failed = 93.8%)', async () => {
    setupMetricsMocks();
    const m = await getLessonPerformanceMetrics();
    expect(m.notificationSuccessRate).toBeCloseTo(93.8, 0);
  });

  it('returns notificationSuccessRate = null when no attempts', async () => {
    setupMetricsMocks({ prosNotified7d: BigInt(0), notificationFailures: BigInt(0) }, []);
    expect((await getLessonPerformanceMetrics()).notificationSuccessRate).toBeNull();
  });

  it('returns avgProsPerRequest = 0 when DB returns null', async () => {
    setupMetricsMocks({ avgProsPerRequest: null });
    expect((await getLessonPerformanceMetrics()).avgProsPerRequest).toBe(0);
  });

  it('returns avgProsFound = 0 when DB returns null', async () => {
    setupMetricsMocks({ avgProsFound: null });
    expect((await getLessonPerformanceMetrics()).avgProsFound).toBe(0);
  });

  it('passes matchRate from DB as-is (null when no fanouts)', async () => {
    setupMetricsMocks({ matchRate: null }, []);
    expect((await getLessonPerformanceMetrics()).matchRate).toBeNull();
  });

  it('matchRate = 90 when 9/10 fanouts found at least one pro', async () => {
    setupMetricsMocks({ matchRate: 90.0 });
    expect((await getLessonPerformanceMetrics()).matchRate).toBe(90.0);
  });

  it('zero-fanout period: all counts are 0, rate and matchRate are null', async () => {
    setupMetricsMocks({
      requestsToday: BigInt(0), requests7d: BigInt(0), uniqueRiders7d: BigInt(0),
      prosNotifiedToday: BigInt(0), prosNotified7d: BigInt(0),
      avgProsPerRequest: null, avgProsFound: null,
      noMatchRequests: BigInt(0), matchRate: null,
      notificationFailures: BigInt(0),
    }, []);
    const m = await getLessonPerformanceMetrics();
    expect(m.requestsToday).toBe(0);
    expect(m.uniqueRiders7d).toBe(0);
    expect(m.avgProsPerRequest).toBe(0);
    expect(m.avgProsFound).toBe(0);
    expect(m.matchRate).toBeNull();
    expect(m.notificationSuccessRate).toBeNull();
  });

  it('100% success rate when failureCount is 0', async () => {
    setupMetricsMocks({ prosNotified7d: BigInt(20), notificationFailures: BigInt(0) });
    expect((await getLessonPerformanceMetrics()).notificationSuccessRate).toBe(100);
  });

  it('rounds avgProsPerRequest to 1 decimal', async () => {
    setupMetricsMocks({ avgProsPerRequest: 7.333333 });
    expect((await getLessonPerformanceMetrics()).avgProsPerRequest).toBe(7.3);
  });

  it('rounds avgProsFound to 1 decimal', async () => {
    setupMetricsMocks({ avgProsFound: 9.666666 });
    expect((await getLessonPerformanceMetrics()).avgProsFound).toBe(9.7);
  });
});

// ─── Tests uniqueRiders7d ─────────────────────────────────────────────────────

describe('getLessonPerformanceMetrics — uniqueRiders7d', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uniqueRiders7d est inférieur ou égal à requests7d (invariant)', async () => {
    setupMetricsMocks({ requests7d: BigInt(10), uniqueRiders7d: BigInt(7) });
    const m = await getLessonPerformanceMetrics();
    expect(m.uniqueRiders7d).toBeLessThanOrEqual(m.requests7d);
    expect(m.uniqueRiders7d).toBe(7);
  });

  it('uniqueRiders7d = requests7d quand chaque rider est actif un seul jour', async () => {
    setupMetricsMocks({ requests7d: BigInt(5), uniqueRiders7d: BigInt(5) });
    const m = await getLessonPerformanceMetrics();
    expect(m.uniqueRiders7d).toBe(m.requests7d);
  });

  it('uniqueRiders7d = 0 si aucun fanout', async () => {
    setupMetricsMocks({ requests7d: BigInt(0), uniqueRiders7d: BigInt(0) }, []);
    const m = await getLessonPerformanceMetrics();
    expect(m.uniqueRiders7d).toBe(0);
  });
});

// ─── Tests bySport ────────────────────────────────────────────────────────────

describe('getLessonPerformanceMetrics — bySport', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('mappe surf / kitesurf / other depuis les lignes SQL', async () => {
    setupMetricsMocks();
    const m = await getLessonPerformanceMetrics();
    expect(m.bySport.surf.requests7d).toBe(6);
    expect(m.bySport.surf.matchRate).toBe(92.0);
    expect(m.bySport.surf.avgProsFound).toBe(7.0);
    expect(m.bySport.kitesurf.requests7d).toBe(3);
    expect(m.bySport.kitesurf.matchRate).toBe(85.0);
    expect(m.bySport.other.requests7d).toBe(1);
    expect(m.bySport.other.matchRate).toBeNull();
    expect(m.bySport.other.avgProsFound).toBe(0);
  });

  it('sport absent dans les résultats SQL → EMPTY_SPORT (0 + null + 0)', async () => {
    setupMetricsMocks({}, [
      { sport: 'surf', requests7d: BigInt(4), matchRate: 80.0, avgProsFound: 5.0 },
      // kitesurf et other absents
    ]);
    const m = await getLessonPerformanceMetrics();
    expect(m.bySport.kitesurf.requests7d).toBe(0);
    expect(m.bySport.kitesurf.matchRate).toBeNull();
    expect(m.bySport.kitesurf.avgProsFound).toBe(0);
    expect(m.bySport.other.requests7d).toBe(0);
  });

  it('avgProsFound null dans DB → 0 pour ce sport', async () => {
    setupMetricsMocks({}, [
      { sport: 'surf', requests7d: BigInt(2), matchRate: 50.0, avgProsFound: null },
    ]);
    const m = await getLessonPerformanceMetrics();
    expect(m.bySport.surf.avgProsFound).toBe(0);
  });

  it('bySport.surf.requests7d converti depuis bigint', async () => {
    setupMetricsMocks({}, [
      { sport: 'surf', requests7d: BigInt(99), matchRate: 100.0, avgProsFound: 10.0 },
    ]);
    const m = await getLessonPerformanceMetrics();
    expect(typeof m.bySport.surf.requests7d).toBe('number');
    expect(m.bySport.surf.requests7d).toBe(99);
  });
});
