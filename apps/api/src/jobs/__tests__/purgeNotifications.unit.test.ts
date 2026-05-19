/**
 * Tests unitaires — purgeNotifications.ts
 *
 * Stratégie : mock de Prisma pour tester la logique de purge sans DB.
 * On valide :
 *   - résolution de la rétention (env, clamp, fallback)
 *   - suppression des notifications > retention
 *   - préservation des notifications récentes
 *   - comportement batch (plusieurs itérations)
 *   - comportement dry-run (aucune suppression)
 *   - cutoff calculé server-side (injection impossible)
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  purgeOldNotifications,
  resolveRetentionDays,
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  DEFAULT_BATCH_SIZE,
} from '../purgeNotifications';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockFindMany = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    notification: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
    $disconnect: jest.fn(),
  },
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIds(count: number): { id: string }[] {
  return Array.from({ length: count }, (_, i) => ({ id: `notif-${i}` }));
}

// ─── resolveRetentionDays ────────────────────────────────────────────────────

describe('resolveRetentionDays', () => {
  beforeEach(() => {
    delete process.env.NOTIFICATION_RETENTION_DAYS;
  });

  it('retourne le défaut si env absent', () => {
    expect(resolveRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('retourne la valeur env si valide', () => {
    process.env.NOTIFICATION_RETENTION_DAYS = '120';
    expect(resolveRetentionDays()).toBe(120);
  });

  it('clamp à MIN_RETENTION_DAYS si valeur trop basse', () => {
    process.env.NOTIFICATION_RETENTION_DAYS = '5';
    expect(resolveRetentionDays()).toBe(MIN_RETENTION_DAYS);
  });

  it('clamp à MAX_RETENTION_DAYS si valeur trop haute', () => {
    process.env.NOTIFICATION_RETENTION_DAYS = '9999';
    expect(resolveRetentionDays()).toBe(MAX_RETENTION_DAYS);
  });

  it('retourne défaut si env non numérique', () => {
    process.env.NOTIFICATION_RETENTION_DAYS = 'abc';
    expect(resolveRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('accepte exactement MIN_RETENTION_DAYS', () => {
    process.env.NOTIFICATION_RETENTION_DAYS = String(MIN_RETENTION_DAYS);
    expect(resolveRetentionDays()).toBe(MIN_RETENTION_DAYS);
  });

  it('accepte exactement MAX_RETENTION_DAYS', () => {
    process.env.NOTIFICATION_RETENTION_DAYS = String(MAX_RETENTION_DAYS);
    expect(resolveRetentionDays()).toBe(MAX_RETENTION_DAYS);
  });
});

// ─── purgeOldNotifications ───────────────────────────────────────────────────

describe('purgeOldNotifications', () => {
  const NOW = new Date('2026-05-19T12:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('supprime un batch de notifications expirées', async () => {
    mockFindMany
      .mockResolvedValueOnce(makeIds(3))
      .mockResolvedValueOnce([]); // Arrêt de la boucle
    mockDeleteMany.mockResolvedValue({ count: 3 });

    const result = await purgeOldNotifications({
      now: NOW,
      retentionDays: 90,
      batchSize: DEFAULT_BATCH_SIZE,
    });

    expect(result.deleted).toBe(3);
    expect(result.batches).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(result.retentionDays).toBe(90);
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
  });

  it('ne supprime rien si aucune notification expirée', async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await purgeOldNotifications({ now: NOW, retentionDays: 90 });

    expect(result.deleted).toBe(0);
    expect(result.batches).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it('effectue plusieurs batches jusqu\'à épuisement', async () => {
    // Batch 1 : plein (500), batch 2 : partiel (200), batch 3 : vide
    mockFindMany
      .mockResolvedValueOnce(makeIds(500))
      .mockResolvedValueOnce(makeIds(200))
      .mockResolvedValueOnce([]);
    mockDeleteMany.mockResolvedValue({ count: 500 }).mockResolvedValueOnce({ count: 200 });

    const result = await purgeOldNotifications({
      now: NOW,
      retentionDays: 90,
      batchSize: 500,
    });

    expect(result.batches).toBe(2);
    expect(result.deleted).toBe(700);
  });

  it('dry-run : ne supprime rien et log le premier batch', async () => {
    mockFindMany.mockResolvedValue(makeIds(50));

    const result = await purgeOldNotifications({ now: NOW, dryRun: true, retentionDays: 90 });

    expect(result.dryRun).toBe(true);
    expect(result.deleted).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
    // Dry-run s'arrête après le premier batch
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it('dry-run ne boucle pas à l\'infini si beaucoup de lignes', async () => {
    // Même si findMany retourne toujours des résultats, dry-run s'arrête après 1 appel
    mockFindMany.mockResolvedValue(makeIds(500));

    await purgeOldNotifications({ now: NOW, dryRun: true, retentionDays: 90 });

    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it('filtre par cutoff = now - retentionDays', async () => {
    mockFindMany.mockResolvedValue([]);

    const now = new Date('2026-05-19T12:00:00Z');
    await purgeOldNotifications({ now, retentionDays: 90 });

    const expectedCutoff = new Date('2026-02-18T12:00:00Z'); // 90 jours avant now

    const findManyCall = mockFindMany.mock.calls[0] as [{ where: { createdAt: { lt: Date } } }];
    const actualCutoff: Date = findManyCall[0].where.createdAt.lt;
    expect(actualCutoff.toISOString()).toBe(expectedCutoff.toISOString());
  });

  it('retourne le cutoff correct dans le résultat', async () => {
    mockFindMany.mockResolvedValue([]);

    const now = new Date('2026-05-19T12:00:00Z');
    const result = await purgeOldNotifications({ now, retentionDays: 60 });

    const expected = new Date('2026-03-20T12:00:00Z'); // 60 jours avant
    expect(result.cutoff.toISOString()).toBe(expected.toISOString());
  });

  it('s\'arrête naturellement si le dernier batch est partiel', async () => {
    // Batch partiel (< batchSize) → boucle se termine sans requête supplémentaire
    mockFindMany.mockResolvedValueOnce(makeIds(10));
    mockDeleteMany.mockResolvedValue({ count: 10 });

    const result = await purgeOldNotifications({ now: NOW, batchSize: 500, retentionDays: 90 });

    expect(result.batches).toBe(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it('respect le batchSize injecté', async () => {
    mockFindMany.mockResolvedValue([]);

    await purgeOldNotifications({ now: NOW, batchSize: 42, retentionDays: 90 });

    const call = mockFindMany.mock.calls[0] as [{ take: number }];
    expect(call[0].take).toBe(42);
  });
});
