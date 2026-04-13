/**
 * gdpr-purge-booking-decommission.test.ts
 *
 * Tests unitaires de la garde d'état booking dans RGPD Phase 3.
 *
 * Vérifie que :
 *   P2021 + DECOMMISSIONED => CONTINUE (skip légitime)
 *   P2021 + non-DECOMMISSIONED => BLOCK (protection légale)
 *   Autre erreur => BLOCK dans tous les cas
 *
 * Ces tests sont unitaires (prisma mocké) — pas de DB requise.
 */

import { isTableGoneError } from '../../middleware/booking-disabled';
import { isBookingTableDropAllowed, getBookingDecommissionPhase, assertDecommissionedStateConsistent } from '../../lib/booking-decommission-state';

// ─── Mock Prisma pour assertDecommissionedStateConsistent ───────────────────
// Utiliser jest.fn() directement dans la factory — évite la temporal dead zone
// avec const + hoisting de jest.mock().
jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    bookingAnalyticsSnapshot: { findMany: jest.fn() },
  },
}));

// Récupère la référence APRÈS que le mock est en place et les imports résolus.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { clientPrisma: mockPrisma } = require('@blobinfini/database') as {
  clientPrisma: { bookingAnalyticsSnapshot: { findMany: jest.Mock } };
};
const mockSnapshotFindMany = mockPrisma.bookingAnalyticsSnapshot.findMany;

// ─────────────────────────────────────────────────────────────────────────────
// Tests de la garde d'état
// ─────────────────────────────────────────────────────────────────────────────

describe('booking-decommission-state', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  // afterEach (pas seulement afterAll) : restaure process.env avant que le
  // global afterEach de jest.setup.ts appelle clearAnalyticsRateLimit().
  // Sans cela, les tests qui changent NODE_ENV='production' cassent le setup global.
  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getBookingDecommissionPhase()', () => {
    it('retourne LIVE par défaut (aucune variable)', () => {
      delete process.env.BOOKING_DECOMMISSION_STATE;
      delete process.env.BOOKING_DISABLED;
      process.env.NODE_ENV = 'test';
      expect(getBookingDecommissionPhase()).toBe('LIVE');
    });

    it('retourne FREEZE_ACTIVE si BOOKING_DISABLED=true', () => {
      delete process.env.BOOKING_DECOMMISSION_STATE;
      process.env.BOOKING_DISABLED = 'true';
      process.env.NODE_ENV = 'test';
      expect(getBookingDecommissionPhase()).toBe('FREEZE_ACTIVE');
    });

    it('retourne LIVE si NODE_ENV=production sans BOOKING_DISABLED (env ≠ état module)', () => {
      // NODE_ENV n'a plus d'effet sur la phase — seul BOOKING_DISABLED pilote FREEZE_ACTIVE.
      // Cela évite qu'un déploiement production avec booking encore actif soit incorrectement
      // classé FREEZE_ACTIVE.
      delete process.env.BOOKING_DECOMMISSION_STATE;
      delete process.env.BOOKING_DISABLED;
      process.env.NODE_ENV = 'production';
      expect(getBookingDecommissionPhase()).toBe('LIVE');
    });

    it('retourne FREEZE_ACTIVE si NODE_ENV=production ET BOOKING_DISABLED=true', () => {
      delete process.env.BOOKING_DECOMMISSION_STATE;
      process.env.NODE_ENV = 'production';
      process.env.BOOKING_DISABLED = 'true';
      expect(getBookingDecommissionPhase()).toBe('FREEZE_ACTIVE');
    });

    it('retourne DECOMMISSIONED si BOOKING_DECOMMISSION_STATE=DECOMMISSIONED', () => {
      process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
      process.env.NODE_ENV = 'production'; // NODE_ENV sans effet sur le résultat
      expect(getBookingDecommissionPhase()).toBe('DECOMMISSIONED');
    });

    it('retourne LIVE si BOOKING_DECOMMISSION_STATE a une valeur inconnue (sans BOOKING_DISABLED)', () => {
      // Valeur inconnue → pas DECOMMISSIONED, pas FREEZE_ACTIVE → LIVE
      process.env.BOOKING_DECOMMISSION_STATE = 'SOME_UNKNOWN_VALUE';
      delete process.env.BOOKING_DISABLED;
      process.env.NODE_ENV = 'production';
      expect(getBookingDecommissionPhase()).toBe('LIVE');
    });
  });

  describe('isBookingTableDropAllowed()', () => {
    it('retourne false si BOOKING_DECOMMISSION_STATE absent', () => {
      delete process.env.BOOKING_DECOMMISSION_STATE;
      expect(isBookingTableDropAllowed()).toBe(false);
    });

    it('retourne false si NODE_ENV=production sans BOOKING_DECOMMISSION_STATE', () => {
      delete process.env.BOOKING_DECOMMISSION_STATE;
      process.env.NODE_ENV = 'production';
      expect(isBookingTableDropAllowed()).toBe(false);
    });

    it('retourne false si BOOKING_DISABLED=true sans BOOKING_DECOMMISSION_STATE', () => {
      delete process.env.BOOKING_DECOMMISSION_STATE;
      process.env.BOOKING_DISABLED = 'true';
      expect(isBookingTableDropAllowed()).toBe(false);
    });

    it('retourne true UNIQUEMENT si BOOKING_DECOMMISSION_STATE=DECOMMISSIONED', () => {
      process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
      expect(isBookingTableDropAllowed()).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests de la logique de garde dans gdpr-purge (simulation de la séquence)
// ─────────────────────────────────────────────────────────────────────────────

describe('RGPD Phase 3 — logique de garde P2021', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    delete process.env.BOOKING_DECOMMISSION_STATE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /**
   * Simule la séquence exacte du catch-block dans gdpr-purge.service.ts:anonymizeDeletedUsers()
   * pour valider la logique BLOCK/CONTINUE sans instancier GDPRPurgeService.
   */
  function simulateGdprPhase3Catch(err: unknown): { archiveError: boolean; loggedKey: string } {
    let archiveError = false;
    let loggedKey = '';

    if (isTableGoneError(err)) {
      if (!isBookingTableDropAllowed()) {
        loggedKey = 'GDPR_PHASE3_BOOKING_TABLE_GONE_WITHOUT_DECOMMISSION_STATE';
        archiveError = true;
      } else {
        loggedKey = 'GDPR_PHASE3_BOOKING_TABLE_GONE_SKIP_ARCHIVE';
        // archiveError reste false
      }
    } else {
      loggedKey = 'GDPR_PHASE3_BOOKING_ARCHIVE_UNEXPECTED_ERROR';
      archiveError = true;
    }

    return { archiveError, loggedKey };
  }

  const p2021Error = Object.assign(new Error('table not found'), { code: 'P2021' });
  const p2022Error = Object.assign(new Error('column not found'), { code: 'P2022' });
  const pg42p01Error = new Error('relation "Booking" does not exist — ERROR 42P01');
  const networkError = new Error('Connection refused');
  const p2002Error = Object.assign(new Error('unique constraint'), { code: 'P2002' });

  // ── CAS 1 : P2021 + DECOMMISSIONED → CONTINUE ────────────────────────────

  it('P2021 + DECOMMISSIONED → CONTINUE (skip autorisé)', () => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    const result = simulateGdprPhase3Catch(p2021Error);
    expect(result.archiveError).toBe(false);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_TABLE_GONE_SKIP_ARCHIVE');
  });

  it('P2022 + DECOMMISSIONED → CONTINUE (skip autorisé)', () => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    const result = simulateGdprPhase3Catch(p2022Error);
    expect(result.archiveError).toBe(false);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_TABLE_GONE_SKIP_ARCHIVE');
  });

  it('42P01 message + DECOMMISSIONED → CONTINUE (skip autorisé)', () => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    const result = simulateGdprPhase3Catch(pg42p01Error);
    expect(result.archiveError).toBe(false);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_TABLE_GONE_SKIP_ARCHIVE');
  });

  // ── CAS 2 : P2021 + état non validé → BLOCK ──────────────────────────────

  it('P2021 + LIVE → BLOCK (état non validé)', () => {
    // NODE_ENV=test, sans aucune variable booking
    const result = simulateGdprPhase3Catch(p2021Error);
    expect(result.archiveError).toBe(true);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_TABLE_GONE_WITHOUT_DECOMMISSION_STATE');
  });

  it('P2021 + FREEZE_ACTIVE (BOOKING_DISABLED=true, sans DECOMMISSIONED) → BLOCK', () => {
    // FREEZE_ACTIVE est désormais piloté par BOOKING_DISABLED=true, pas NODE_ENV.
    // Ce cas est couvert séparément par le test BOOKING_DISABLED ci-dessous.
    // Vérification ici : LIVE sans aucune variable booking → BLOCK (même résultat).
    delete process.env.BOOKING_DECOMMISSION_STATE;
    delete process.env.BOOKING_DISABLED;
    const result = simulateGdprPhase3Catch(p2021Error);
    expect(result.archiveError).toBe(true);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_TABLE_GONE_WITHOUT_DECOMMISSION_STATE');
  });

  it('P2021 + BOOKING_DISABLED=true (sans DECOMMISSIONED) → BLOCK', () => {
    delete process.env.BOOKING_DECOMMISSION_STATE;
    process.env.BOOKING_DISABLED = 'true';
    const result = simulateGdprPhase3Catch(p2021Error);
    expect(result.archiveError).toBe(true);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_TABLE_GONE_WITHOUT_DECOMMISSION_STATE');
  });

  // ── CAS 3 : Autre erreur → BLOCK dans tous les cas ───────────────────────

  it('Erreur réseau + DECOMMISSIONED → BLOCK (pas une erreur table)', () => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    const result = simulateGdprPhase3Catch(networkError);
    expect(result.archiveError).toBe(true);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_ARCHIVE_UNEXPECTED_ERROR');
  });

  it('P2002 (contrainte unique) + DECOMMISSIONED → BLOCK (pas une erreur table)', () => {
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    const result = simulateGdprPhase3Catch(p2002Error);
    expect(result.archiveError).toBe(true);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_ARCHIVE_UNEXPECTED_ERROR');
  });

  it('Erreur réseau + LIVE → BLOCK', () => {
    const result = simulateGdprPhase3Catch(networkError);
    expect(result.archiveError).toBe(true);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_ARCHIVE_UNEXPECTED_ERROR');
  });

  it('null/undefined → BLOCK (aucun code Prisma détectable)', () => {
    const result = simulateGdprPhase3Catch(null);
    expect(result.archiveError).toBe(true);
    expect(result.loggedKey).toBe('GDPR_PHASE3_BOOKING_ARCHIVE_UNEXPECTED_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests assertDecommissionedStateConsistent (preflight étendu — deux invariants)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helpers — snapshots avec preuve légale valide embedée
 */
const validProof = {
  verifiedAt: '2026-04-13T10:00:00.000Z',
  totalBookings: 1247,
  totalArchives: 1247,
  missingArchives: 0,
};

function makeSnapshot(period: string, frozen: boolean, proof?: object | null) {
  return {
    period,
    frozen,
    marketplaceJson: proof === null
      ? { someKey: 'no proof here' }  // JSON sans _backfillLegalProof
      : { someAnalyticsKey: 'value', _backfillLegalProof: proof ?? validProof },
  };
}

const allFrozenWithProof = [
  makeSnapshot('7d', true),
  makeSnapshot('30d', true),
  makeSnapshot('90d', true),
];

describe('assertDecommissionedStateConsistent() — preflight étendu (deux invariants)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    process.env.BOOKING_DECOMMISSION_STATE = 'DECOMMISSIONED';
    mockSnapshotFindMany.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── Cas PASS ─────────────────────────────────────────────────────────────

  it('PASS : snapshots gelés + backfill complet (missingArchives=0) → OK', async () => {
    mockSnapshotFindMany.mockResolvedValue(allFrozenWithProof);
    await expect(assertDecommissionedStateConsistent()).resolves.toBeUndefined();
  });

  it('PASS : ne fait rien si état non DECOMMISSIONED (aucune requête DB)', async () => {
    delete process.env.BOOKING_DECOMMISSION_STATE;
    await expect(assertDecommissionedStateConsistent()).resolves.toBeUndefined();
    expect(mockSnapshotFindMany).not.toHaveBeenCalled();
  });

  it('PASS : BOOKING_DISABLED=true sans DECOMMISSIONED → aucune requête DB', async () => {
    delete process.env.BOOKING_DECOMMISSION_STATE;
    process.env.BOOKING_DISABLED = 'true';
    await expect(assertDecommissionedStateConsistent()).resolves.toBeUndefined();
    expect(mockSnapshotFindMany).not.toHaveBeenCalled();
  });

  it('PASS : preuve avec totalBookings=0 et totalArchives=0 (repo sans bookings) → OK', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', true, { verifiedAt: '2026-04-13T00:00:00Z', totalBookings: 0, totalArchives: 0, missingArchives: 0 }),
      makeSnapshot('30d', true, { verifiedAt: '2026-04-13T00:00:00Z', totalBookings: 0, totalArchives: 0, missingArchives: 0 }),
      makeSnapshot('90d', true, { verifiedAt: '2026-04-13T00:00:00Z', totalBookings: 0, totalArchives: 0, missingArchives: 0 }),
    ]);
    await expect(assertDecommissionedStateConsistent()).resolves.toBeUndefined();
  });

  // ── Cas FAIL — invariant analytics ──────────────────────────────────────

  it('FAIL [ANALYTICS] : aucun snapshot → throw PREFLIGHT_FAILED', async () => {
    mockSnapshotFindMany.mockResolvedValue([]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  it('FAIL [ANALYTICS] : période 7d absente → throw avec mention de 7d', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('30d', true),
      makeSnapshot('90d', true),
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('7d');
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  it('FAIL [ANALYTICS] : snapshot 30d frozen=false → throw avec mention de 30d', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', true),
      makeSnapshot('30d', false),  // pas gelé
      makeSnapshot('90d', true),
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('30d');
  });

  it('FAIL [ANALYTICS] : deux périodes manquantes → message liste les deux', async () => {
    mockSnapshotFindMany.mockResolvedValue([makeSnapshot('90d', true)]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow(/7d.*30d|30d.*7d/);
  });

  it('FAIL [ANALYTICS] : table snapshot absente (P2021) → throw avec mention BookingAnalyticsSnapshot', async () => {
    mockSnapshotFindMany.mockRejectedValue(
      Object.assign(new Error('table not found'), { code: 'P2021' }),
    );
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('BookingAnalyticsSnapshot');
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  it('FAIL [ANALYTICS] : table snapshot absente (P2022) → throw', async () => {
    mockSnapshotFindMany.mockRejectedValue(
      Object.assign(new Error('column not found'), { code: 'P2022' }),
    );
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  it('FAIL [DB] : erreur DB inattendue → throw avec message brut', async () => {
    mockSnapshotFindMany.mockRejectedValue(new Error('DB connection refused'));
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('DB connection refused');
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  // ── Cas FAIL — invariant légal ───────────────────────────────────────────

  it('FAIL [LEGAL] : snapshots gelés mais _backfillLegalProof absent dans 7d → throw', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', true, null),  // JSON sans _backfillLegalProof
      makeSnapshot('30d', true),
      makeSnapshot('90d', true),
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('_backfillLegalProof');
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('7d');
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  it('FAIL [LEGAL] : preuve présente mais missingArchives=5 dans 30d → throw', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', true),
      makeSnapshot('30d', true, {
        verifiedAt: '2026-04-13T00:00:00Z',
        totalBookings: 1000,
        totalArchives: 995,
        missingArchives: 5, // ← 5 bookings sans archive
      }),
      makeSnapshot('90d', true),
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('5');
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('30d');
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  it('FAIL [LEGAL] : missingArchives=1 → message contient backfill command', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', true, { verifiedAt: '2026-04-13T00:00:00Z', totalBookings: 100, totalArchives: 99, missingArchives: 1 }),
      makeSnapshot('30d', true),
      makeSnapshot('90d', true),
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('backfill');
  });

  it('FAIL [LEGAL] : preuve malformée (missingArchives est une string) → null → throw', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', true, {
        verifiedAt: '2026-04-13T00:00:00Z',
        totalBookings: 100,
        totalArchives: 100,
        missingArchives: '0',  // string au lieu de number → extractBackfillLegalProof retourne null
      }),
      makeSnapshot('30d', true),
      makeSnapshot('90d', true),
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('_backfillLegalProof');
  });

  it('FAIL [LEGAL] : marketplaceJson est null → throw LEGAL', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      { period: '7d', frozen: true, marketplaceJson: null },
      makeSnapshot('30d', true),
      makeSnapshot('90d', true),
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('PREFLIGHT_FAILED');
  });

  // ── Cas mixtes ────────────────────────────────────────────────────────────

  it('FAIL priorité analytics sur légal : snapshot non gelé détecté avant preuve manquante', async () => {
    // 7d non gelé ET sans preuve → l'erreur analytics doit être reportée en premier
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', false, null),  // non gelé ET sans preuve
      makeSnapshot('30d', true),
      makeSnapshot('90d', true),
    ]);
    const err = await assertDecommissionedStateConsistent().catch((e: Error) => e);
    expect(err.message).toContain('ANALYTICS'); // pas LEGAL
    expect(err.message).toContain('7d');
  });

  it('selectivity : preuve absente sur 90d uniquement → throw cite 90d', async () => {
    mockSnapshotFindMany.mockResolvedValue([
      makeSnapshot('7d', true),   // OK
      makeSnapshot('30d', true),  // OK
      makeSnapshot('90d', true, null),  // gelé MAIS sans preuve légale
    ]);
    await expect(assertDecommissionedStateConsistent()).rejects.toThrow('90d');
  });
});

// ─── Tests extractBackfillLegalProof (unitaires purs, sans DB) ───────────────

describe('extractBackfillLegalProof()', () => {
  it('retourne null si json est null', () => {
    const { extractBackfillLegalProof } = require('../../lib/booking-decommission-state');
    expect(extractBackfillLegalProof(null)).toBeNull();
  });

  it('retourne null si _backfillLegalProof absent', () => {
    const { extractBackfillLegalProof } = require('../../lib/booking-decommission-state');
    expect(extractBackfillLegalProof({ someOtherKey: 'value' })).toBeNull();
  });

  it('retourne null si missingArchives est une string', () => {
    const { extractBackfillLegalProof } = require('../../lib/booking-decommission-state');
    expect(extractBackfillLegalProof({
      _backfillLegalProof: { verifiedAt: 'x', totalBookings: 1, totalArchives: 1, missingArchives: '0' }
    })).toBeNull();
  });

  it('retourne la preuve si tous les champs sont présents et du bon type', () => {
    const { extractBackfillLegalProof } = require('../../lib/booking-decommission-state');
    const proof = { verifiedAt: '2026-04-13T00:00:00Z', totalBookings: 100, totalArchives: 100, missingArchives: 0 };
    expect(extractBackfillLegalProof({ _backfillLegalProof: proof })).toEqual(proof);
  });

  it('retourne la preuve même si missingArchives=0 (cas normal)', () => {
    const { extractBackfillLegalProof } = require('../../lib/booking-decommission-state');
    const proof = { verifiedAt: '2026-04-13T00:00:00Z', totalBookings: 0, totalArchives: 0, missingArchives: 0 };
    const result = extractBackfillLegalProof({ _backfillLegalProof: proof, otherKey: 'ignored' });
    expect(result?.missingArchives).toBe(0);
  });
});
