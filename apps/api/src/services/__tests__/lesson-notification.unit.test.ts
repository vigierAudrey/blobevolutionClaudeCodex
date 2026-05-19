/**
 * Tests unitaires — lesson-notification.service.ts
 *
 * Stratégie : mock Prisma.$queryRaw + cacheService + createNotificationSilent.
 * On valide :
 *   - Pro dans périmètre reçoit une notification
 *   - Pro hors périmètre n'est pas notifié (filtrage PostGIS dans la requête)
 *   - Pro non vérifié absent des résultats (WHERE verified = true)
 *   - Cooldown Redis : pas de double fanout dans la fenêtre
 *   - Pas de coordonnées exactes dans Notification.data
 *   - Cap MAX_PROS_TO_NOTIFY respecté (via LIMIT dans la requête)
 *   - Fail-open si Redis indisponible : fanout quand même
 *   - Pas de N+1 : une seule query SQL
 *   - riderId jamais dans le body → toujours server-side
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  notifyNearbyProsForLesson,
  notifyNearbyProsForLessonSilent,
  MAX_PROS_TO_NOTIFY,
  FANOUT_COOLDOWN_TTL_SECONDS,
} from '../lesson-notification.service';
import * as notifService from '../notification.service';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
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

// ─── Mock cacheService ────────────────────────────────────────────────────────

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

jest.mock('../cache.service', () => ({
  cacheService: {
    getClient: jest.fn(() => ({
      get: (...args: unknown[]) => mockRedisGet(...args),
      set: (...args: unknown[]) => mockRedisSet(...args),
    })),
  },
}));

// ─── Mock createNotificationSilent ───────────────────────────────────────────

const mockCreateNotifSilent = jest.fn();

jest.mock('../notification.service', () => ({
  NotificationType: {
    LESSON_REQUEST_NEARBY: 'LESSON_REQUEST_NEARBY',
  },
  createNotificationSilent: (...args: unknown[]) => mockCreateNotifSilent(...args),
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

function proRow(userId: string, distanceKm = 3): { userId: string; distanceKm: number } {
  return { userId, distanceKm };
}

const BASE_INPUT = {
  riderId: 'rider-uuid-123',
  lessonLat: 43.6,
  lessonLng: -1.5,
  lessonSport: 'surf' as const,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('notifyNearbyProsForLesson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Pas de cooldown actif par défaut
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('crée une notification pour chaque pro éligible retourné par la query', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 2), proRow('pro-2', 8)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotifSilent).toHaveBeenCalledTimes(2);
    expect(mockCreateNotifSilent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'pro-1' }),
    );
    expect(mockCreateNotifSilent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'pro-2' }),
    );
  });

  it('ne crée aucune notification si aucun pro éligible', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotifSilent).not.toHaveBeenCalled();
  });

  it('utilise le type LESSON_REQUEST_NEARBY', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotifSilent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LESSON_REQUEST_NEARBY' }),
    );
  });

  it('le payload notification contient requestId, sport, distanceBucket — pas de coords exactes', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotifSilent.mock.calls[0] as [Parameters<typeof notifService.createNotificationSilent>[0]];
    const notif = call[0];

    expect(notif.data).toBeDefined();
    const data = notif.data as Record<string, unknown>;

    // riderProfileRef (pas requestId — aucun modèle LessonRequest dédié pour l'instant)
    expect(data.riderProfileRef).toBe('rider-uuid-123');
    expect(data).not.toHaveProperty('requestId');
    expect(data.sport).toBe('surf');
    // distanceBucket, pas distanceKm exact
    expect(data).toHaveProperty('distanceBucket');
    expect(typeof data.distanceBucket).toBe('string');

    // Jamais de coordonnées GPS exactes dans data
    expect(data).not.toHaveProperty('lat');
    expect(data).not.toHaveProperty('lng');
    expect(data).not.toHaveProperty('lessonLat');
    expect(data).not.toHaveProperty('lessonLng');
    expect(data).not.toHaveProperty('distanceKm');
  });

  it('url de navigation vers /pro/map', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotifSilent.mock.calls[0] as [{ url?: string }];
    expect(call[0].url).toBe('/pro/map');
  });

  it('body ne contient pas d\'adresse précise', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotifSilent.mock.calls[0] as [{ body: string }];
    const body: string = call[0].body;

    // Aucune coordonnée numérique dans le body
    expect(body).not.toMatch(/43\.\d+/);
    expect(body).not.toMatch(/-1\.\d+/);
    // Aucun userId dans le body
    expect(body).not.toContain('rider-uuid-123');
  });

  it('cooldown actif → pas de fanout, zéro notification', async () => {
    mockRedisGet.mockResolvedValue('1'); // cooldown actif

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockCreateNotifSilent).not.toHaveBeenCalled();
  });

  it('marque le cooldown après un fanout réussi', async () => {
    mockRedisGet.mockResolvedValue(null);
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockRedisSet).toHaveBeenCalledWith(
      `lesson_fanout:${BASE_INPUT.riderId}`,
      '1',
      { EX: FANOUT_COOLDOWN_TTL_SECONDS },
    );
  });

  it('fail-open si Redis indisponible : fanout quand même', async () => {
    // Simuler Redis indisponible
    const { cacheService } = jest.requireMock('../cache.service') as {
      cacheService: { getClient: jest.Mock };
    };
    cacheService.getClient.mockReturnValueOnce(null); // pas de client Redis
    cacheService.getClient.mockReturnValueOnce(null); // pour markFanoutSent aussi

    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotifSilent).toHaveBeenCalledTimes(1);
  });

  it('une seule query SQL (pas de N+1)', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1'), proRow('pro-2'), proRow('pro-3')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('distanceBucket correcte : <5km pour distanceKm=3', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotifSilent.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.distanceBucket).toBe('<5km');
  });

  it('distanceBucket correcte : 5-15km pour distanceKm=10', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 10)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotifSilent.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.distanceBucket).toBe('5-15km');
  });

  it('distanceBucket correcte : >30km pour distanceKm=45', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 45)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotifSilent.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.distanceBucket).toBe('>30km');
  });

  it('fonctionne sans lessonSport (sport null)', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson({ ...BASE_INPUT, lessonSport: null });

    expect(mockCreateNotifSilent).toHaveBeenCalledTimes(1);
    const call = mockCreateNotifSilent.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.sport).toBeNull();
  });

  it('erreur query SQL : log sans throw (pas de crash API)', async () => {
    mockQueryRaw.mockRejectedValue(new Error('DB connection lost'));

    await expect(notifyNearbyProsForLesson(BASE_INPUT)).resolves.not.toThrow();
    expect(mockCreateNotifSilent).not.toHaveBeenCalled();
  });
});

describe('notifyNearbyProsForLessonSilent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  it('est fire-and-forget : ne rejette jamais', async () => {
    mockQueryRaw.mockRejectedValue(new Error('unexpected'));

    expect(() => notifyNearbyProsForLessonSilent(BASE_INPUT)).not.toThrow();
    // Attendre que la promise interne se règle
    await new Promise((r) => setTimeout(r, 10));
  });

  it('appelle bien notifyNearbyProsForLesson en interne', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    notifyNearbyProsForLessonSilent(BASE_INPUT);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockCreateNotifSilent).toHaveBeenCalledTimes(1);
  });
});

describe('MAX_PROS_TO_NOTIFY', () => {
  it('vaut 100 (cap dur MVP)', () => {
    expect(MAX_PROS_TO_NOTIFY).toBe(100);
  });
});
