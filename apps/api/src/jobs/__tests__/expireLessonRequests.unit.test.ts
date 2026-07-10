/**
 * Tests unitaires — expireLessonRequests.ts
 *
 * Stratégie : mock de Prisma pour tester la logique d'expiration sans DB.
 * On valide :
 *   - résolution du TTL sans-date (env, clamp, fallback)
 *   - cutoff date = minuit UTC du jour courant (une demande datée d'aujourd'hui survit)
 *   - désactivation des demandes à date passée (wantsLesson=false + coords effacées)
 *   - désactivation des demandes sans date au-delà du TTL
 *   - notification in-app envoyée à chaque rider expiré
 *   - comportement batch (plusieurs itérations)
 *   - comportement dry-run (aucune écriture, aucune notification)
 *   - cutoffs calculés server-side (injection impossible)
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  expireLessonRequests,
  resolveDatelessTtlDays,
  startOfTodayUtc,
  DEFAULT_DATELESS_TTL_DAYS,
  MIN_DATELESS_TTL_DAYS,
  MAX_DATELESS_TTL_DAYS,
  DEFAULT_BATCH_SIZE,
} from '../expireLessonRequests';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockFindMany = jest.fn();
const mockUpdateMany = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    riderProfile: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    $disconnect: jest.fn(),
  },
}));

const mockCreateNotificationSilent = jest.fn();

jest.mock('../../services/notification.service', () => ({
  createNotificationSilent: (...args: unknown[]) => mockCreateNotificationSilent(...args),
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

function makeRows(count: number, prefix: string): { id: string; userId: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-profile-${i}`,
    userId: `${prefix}-user-${i}`,
  }));
}

/** Par défaut : aucun profil à expirer (les deux boucles s'arrêtent immédiatement). */
function mockNoExpirable() {
  mockFindMany.mockResolvedValue([]);
}

const NOW = new Date('2026-07-10T14:30:00.000Z');

// ─── resolveDatelessTtlDays ──────────────────────────────────────────────────

describe('resolveDatelessTtlDays', () => {
  beforeEach(() => {
    delete process.env.LESSON_DATELESS_TTL_DAYS;
  });

  it('retourne le défaut si env absent', () => {
    expect(resolveDatelessTtlDays()).toBe(DEFAULT_DATELESS_TTL_DAYS);
  });

  it('retourne la valeur env si valide', () => {
    process.env.LESSON_DATELESS_TTL_DAYS = '45';
    expect(resolveDatelessTtlDays()).toBe(45);
  });

  it('clamp à MIN_DATELESS_TTL_DAYS si valeur trop basse', () => {
    process.env.LESSON_DATELESS_TTL_DAYS = '1';
    expect(resolveDatelessTtlDays()).toBe(MIN_DATELESS_TTL_DAYS);
  });

  it('clamp à MAX_DATELESS_TTL_DAYS si valeur trop haute', () => {
    process.env.LESSON_DATELESS_TTL_DAYS = '9999';
    expect(resolveDatelessTtlDays()).toBe(MAX_DATELESS_TTL_DAYS);
  });

  it('retourne défaut si env non numérique', () => {
    process.env.LESSON_DATELESS_TTL_DAYS = 'abc';
    expect(resolveDatelessTtlDays()).toBe(DEFAULT_DATELESS_TTL_DAYS);
  });
});

// ─── startOfTodayUtc ─────────────────────────────────────────────────────────

describe('startOfTodayUtc', () => {
  it('retourne minuit UTC du jour de la date fournie', () => {
    expect(startOfTodayUtc(NOW).toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });
});

// ─── expireLessonRequests ────────────────────────────────────────────────────

describe('expireLessonRequests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LESSON_DATELESS_TTL_DAYS;
    mockUpdateMany.mockImplementation(async (args: any) => ({
      count: args.where.id.in.length,
    }));
  });

  it('les cutoffs sont calculés server-side depuis now', async () => {
    mockNoExpirable();

    await expireLessonRequests({ now: NOW, datelessTtlDays: 30 });

    // Boucle 1 : demandes datées — lessonDate < minuit UTC du jour
    expect(mockFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        wantsLesson: true,
        lessonDate: { lt: new Date('2026-07-10T00:00:00.000Z') },
      },
    }));
    // Boucle 2 : demandes sans date — updatedAt < now - 30 j
    expect(mockFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        wantsLesson: true,
        lessonDate: null,
        updatedAt: { lt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) },
      },
    }));
  });

  it('désactive les demandes à date passée : wantsLesson=false + coords effacées', async () => {
    const rows = makeRows(3, 'dated');
    mockFindMany
      .mockResolvedValueOnce(rows) // boucle datée
      .mockResolvedValueOnce([]);  // boucle sans-date

    const result = await expireLessonRequests({ now: NOW });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { wantsLesson: false, lessonLat: null, lessonLng: null },
    });
    expect(result.expiredDated).toBe(3);
    expect(result.expiredDateless).toBe(0);
  });

  it('désactive les demandes sans date au-delà du TTL', async () => {
    const rows = makeRows(2, 'dateless');
    mockFindMany
      .mockResolvedValueOnce([])   // boucle datée
      .mockResolvedValueOnce(rows); // boucle sans-date

    const result = await expireLessonRequests({ now: NOW });

    expect(result.expiredDated).toBe(0);
    expect(result.expiredDateless).toBe(2);
  });

  it('notifie chaque rider expiré en in-app avec le lien /lesson-request', async () => {
    mockFindMany
      .mockResolvedValueOnce(makeRows(2, 'dated'))
      .mockResolvedValueOnce(makeRows(1, 'dateless'));

    await expireLessonRequests({ now: NOW });

    expect(mockCreateNotificationSilent).toHaveBeenCalledTimes(3);
    expect(mockCreateNotificationSilent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'dated-user-0',
        type: 'SYSTEM',
        url: '/lesson-request',
      }),
    );
  });

  it('traite par batch tant que le batch est plein', async () => {
    const batchSize = 2;
    mockFindMany
      .mockResolvedValueOnce(makeRows(2, 'a')) // batch plein → continue
      .mockResolvedValueOnce(makeRows(1, 'b')) // batch partiel → stop
      .mockResolvedValueOnce([]);              // boucle sans-date

    const result = await expireLessonRequests({ now: NOW, batchSize });

    expect(result.expiredDated).toBe(3);
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('dry-run : aucune écriture, aucune notification', async () => {
    mockFindMany
      .mockResolvedValueOnce(makeRows(5, 'dated'))
      .mockResolvedValueOnce(makeRows(2, 'dateless'));

    const result = await expireLessonRequests({ now: NOW, dryRun: true });

    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockCreateNotificationSilent).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.expiredDated).toBe(0);
    expect(result.expiredDateless).toBe(0);
  });

  it('utilise DEFAULT_BATCH_SIZE par défaut', async () => {
    mockNoExpirable();

    await expireLessonRequests({ now: NOW });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: DEFAULT_BATCH_SIZE }),
    );
  });

  it('une demande datée d’aujourd’hui n’est PAS expirée (cutoff = minuit UTC)', async () => {
    mockNoExpirable();

    await expireLessonRequests({ now: new Date('2026-07-10T23:59:59.000Z') });

    const firstWhere = (mockFindMany.mock.calls[0][0] as any).where;
    // lt minuit du 10 : une lessonDate du 10 (>= minuit) ne matche pas.
    expect(firstWhere.lessonDate.lt.toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });
});
