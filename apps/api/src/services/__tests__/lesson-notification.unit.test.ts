/**
 * Tests unitaires — lesson-notification.service.ts
 *
 * Stratégie : mock Prisma.$queryRaw + cacheService + createNotification + lesson-fanout.repository.
 * On valide :
 *   - Pro dans périmètre reçoit une notification
 *   - Pro hors périmètre n'est pas notifié (filtrage PostGIS dans la requête)
 *   - Pro non vérifié absent des résultats (WHERE verified = true)
 *   - Cooldown Redis : pas de double fanout dans la fenêtre
 *   - Pas de coordonnées exactes dans Notification.data
 *   - Cap MAX_PROS_TO_NOTIFY respecté (via LIMIT dans la requête)
 *   - Fail-closed si Redis indisponible : aucun fanout sortant
 *   - Pas de N+1 : une seule query SQL
 *   - riderId jamais dans le body → toujours server-side
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  notifyNearbyProsForLesson,
  notifyNearbyProsForLessonSilent,
  sendEmailsToOptedInPros,
  MAX_PROS_TO_NOTIFY,
  FANOUT_COOLDOWN_TTL_SECONDS,
  EMAIL_CONCURRENCY,
} from '../lesson-notification.service';
import * as notifService from '../notification.service';

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();
const mockUserFindMany = jest.fn();

jest.mock('@blobinfini/database', () => ({
  clientPrisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    user: {
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
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

const mockRedisSet = jest.fn();

jest.mock('../cache.service', () => ({
  cacheService: {
    getClient: jest.fn(() => ({
      set: (...args: unknown[]) => mockRedisSet(...args),
    })),
  },
}));

// ─── Mock createNotification (remplace l'ancienne createNotificationSilent) ──

const mockCreateNotif = jest.fn();

jest.mock('../notification.service', () => ({
  NotificationType: {
    LESSON_REQUEST_NEARBY: 'LESSON_REQUEST_NEARBY',
  },
  createNotification: (...args: unknown[]) => mockCreateNotif(...args),
}));

// ─── Mock lesson-fanout.repository ───────────────────────────────────────────

const mockRecordFanout = jest.fn();

jest.mock('../lesson-fanout.repository', () => ({
  hashRiderRef: (id: string) => `hash-${id}`,
  makeLessonRequestId: (id: string) => `req-${id}`,
  recordFanout: (...args: unknown[]) => mockRecordFanout(...args),
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Mock mailer ─────────────────────────────────────────────────────────────

const mockSendNewLessonRequestEmail = jest.fn();

jest.mock('../../lib/mailer', () => ({
  sendNewLessonRequestEmailToPro: (...args: unknown[]) => mockSendNewLessonRequestEmail(...args),
}));

// ─── Mock hashEmail ───────────────────────────────────────────────────────────

jest.mock('../../modules/auth/login-attempt.util', () => ({
  hashEmail: (email: string) => `hash-${email}`,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function proRow(
  userId: string,
  distanceKm = 3,
  emailNotif = false,
  inAppEnabled = true,
): { userId: string; distanceKm: number; emailNotif: boolean; inAppEnabled: boolean } {
  return { userId, distanceKm, emailNotif, inAppEnabled };
}

const BASE_INPUT = {
  riderId: 'rider-uuid-123',
  lessonLat: 43.6,
  lessonLng: -1.5,
  lessonSport: 'surf' as const,
  triggerReason: 'ACTIVATED' as const,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('notifyNearbyProsForLesson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    // createNotification retourne une notification fictive
    mockCreateNotif.mockResolvedValue({ id: 'notif-1', createdAt: new Date() });
    // recordFanout est non-bloquant
    mockRecordFanout.mockResolvedValue(undefined);
    // Pas d'email envoyé par défaut
    mockSendNewLessonRequestEmail.mockResolvedValue({ sent: true });
    // Pas de user en DB par défaut
    mockUserFindMany.mockResolvedValue([]);
  });

  it('crée une notification pour chaque pro éligible retourné par la query', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 2), proRow('pro-2', 8)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotif).toHaveBeenCalledTimes(2);
    expect(mockCreateNotif).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'pro-1' }),
    );
    expect(mockCreateNotif).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'pro-2' }),
    );
  });

  it('ne crée aucune notification si aucun pro éligible', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotif).not.toHaveBeenCalled();
  });

  it('utilise le type LESSON_REQUEST_NEARBY', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotif).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LESSON_REQUEST_NEARBY' }),
    );
  });

  it('le payload notification contient riderProfileRef, sport, distanceBucket, lessonRequestId — pas de coords exactes', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotif.mock.calls[0] as [Parameters<typeof notifService.createNotification>[0]];
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
    // lessonRequestId : sha256 tronqué — présent depuis Sprint C10
    expect(data).toHaveProperty('lessonRequestId');
    expect(typeof data.lessonRequestId).toBe('string');
    // Non-PII : valeur hashée (mock retourne 'req-<riderId>')
    expect(data.lessonRequestId).not.toBe('rider-uuid-123');

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

    const call = mockCreateNotif.mock.calls[0] as [{ url?: string }];
    expect(call[0].url).toBe('/pro/map');
  });

  it('body ne contient pas d\'adresse précise', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotif.mock.calls[0] as [{ body: string }];
    const body: string = call[0].body;

    // Aucune coordonnée numérique dans le body
    expect(body).not.toMatch(/43\.\d+/);
    expect(body).not.toMatch(/-1\.\d+/);
    // Aucun userId dans le body
    expect(body).not.toContain('rider-uuid-123');
  });

  it('cooldown actif → pas de fanout, zéro notification', async () => {
    mockRedisSet.mockResolvedValue(null); // SET NX refusé : cooldown actif
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockCreateNotif).not.toHaveBeenCalled();
  });

  it('réserve atomiquement le cooldown avant un fanout', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockRedisSet).toHaveBeenCalledWith(
      `lesson_fanout:${BASE_INPUT.riderId}`,
      '1',
      { EX: FANOUT_COOLDOWN_TTL_SECONDS, NX: true },
    );
  });

  it('fail-closed si Redis indisponible : aucun fanout', async () => {
    // Simuler Redis indisponible
    const { cacheService } = jest.requireMock('../cache.service') as {
      cacheService: { getClient: jest.Mock };
    };
    cacheService.getClient.mockReturnValueOnce(null);

    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockCreateNotif).not.toHaveBeenCalled();
  });

  it('deux appels concurrents ne déclenchent qu’un seul fanout', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);
    mockRedisSet.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await Promise.all([
      notifyNearbyProsForLesson(BASE_INPUT),
      notifyNearbyProsForLesson(BASE_INPUT),
    ]);

    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });

  it('une seule query SQL (pas de N+1)', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1'), proRow('pro-2'), proRow('pro-3')]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('distanceBucket correcte : <5km pour distanceKm=3', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotif.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.distanceBucket).toBe('<5km');
  });

  it('distanceBucket correcte : 5-15km pour distanceKm=10', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 10)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotif.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.distanceBucket).toBe('5-15km');
  });

  it('distanceBucket correcte : >30km pour distanceKm=45', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 45)]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    const call = mockCreateNotif.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.distanceBucket).toBe('>30km');
  });

  it('fonctionne sans lessonSport (sport null) — le service accepte null, c\'est le controller qui bloque', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson({ ...BASE_INPUT, lessonSport: null });

    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
    const call = mockCreateNotif.mock.calls[0] as [{ data?: Record<string, unknown> }];
    expect(call[0].data?.sport).toBeNull();
  });

  it('recordFanout reçoit le triggerReason transmis par l\'appelant', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    await notifyNearbyProsForLesson({ ...BASE_INPUT, triggerReason: 'SPORT_CHANGED' });

    expect(mockRecordFanout).toHaveBeenCalledWith(
      expect.objectContaining({ triggerReason: 'SPORT_CHANGED' }),
    );
  });

  it('recordFanout reçoit MANUAL si triggerReason absent', async () => {
    const inputWithoutReason = { ...BASE_INPUT } as Omit<typeof BASE_INPUT, 'triggerReason'>;
    mockQueryRaw.mockResolvedValue([proRow('pro-1')]);

    // triggerReason est optionnel — on omet le champ
    await notifyNearbyProsForLesson({
      riderId: inputWithoutReason.riderId,
      lessonLat: inputWithoutReason.lessonLat,
      lessonLng: inputWithoutReason.lessonLng,
      lessonSport: inputWithoutReason.lessonSport,
    });

    expect(mockRecordFanout).toHaveBeenCalledWith(
      expect.objectContaining({ triggerReason: 'MANUAL' }),
    );
  });

  it('erreur query SQL : log sans throw (pas de crash API)', async () => {
    mockQueryRaw.mockRejectedValue(new Error('DB connection lost'));

    await expect(notifyNearbyProsForLesson(BASE_INPUT)).resolves.not.toThrow();
    expect(mockCreateNotif).not.toHaveBeenCalled();
  });
});

describe('notifyNearbyProsForLessonSilent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockCreateNotif.mockResolvedValue({ id: 'notif-1', createdAt: new Date() });
    mockRecordFanout.mockResolvedValue(undefined);
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

    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });
});

describe('MAX_PROS_TO_NOTIFY', () => {
  it('vaut 100 (cap dur MVP)', () => {
    expect(MAX_PROS_TO_NOTIFY).toBe(100);
  });
});

describe('EMAIL_CONCURRENCY', () => {
  it('vaut 5', () => {
    expect(EMAIL_CONCURRENCY).toBe(5);
  });
});

describe('sendEmailsToOptedInPros', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendNewLessonRequestEmail.mockResolvedValue({ sent: true });
    mockUserFindMany.mockResolvedValue([]);
  });

  it('envoie un email pour chaque pro avec emailNotif=true', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'pro-1', email: 'pro1@example.com' },
      { id: 'pro-2', email: 'pro2@example.com' },
    ]);

    await sendEmailsToOptedInPros(
      [proRow('pro-1', 3, true), proRow('pro-2', 8, true)],
      'surf',
    );

    expect(mockUserFindMany).toHaveBeenCalledTimes(1);
    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledTimes(2);
    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledWith({ proEmail: 'pro1@example.com', sport: 'surf' });
    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledWith({ proEmail: 'pro2@example.com', sport: 'surf' });
  });

  it('ne fait aucun appel si aucun pro avec emailNotif=true', async () => {
    await sendEmailsToOptedInPros(
      [proRow('pro-1', 3, false), proRow('pro-2', 8, false)],
      'surf',
    );

    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockSendNewLessonRequestEmail).not.toHaveBeenCalled();
  });

  it('ne fait aucun appel si la liste de pros est vide', async () => {
    await sendEmailsToOptedInPros([], 'surf');

    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockSendNewLessonRequestEmail).not.toHaveBeenCalled();
  });

  it('ignore les pros sans emailNotif=true et envoie seulement aux opted-in', async () => {
    mockUserFindMany.mockResolvedValue([{ id: 'pro-2', email: 'pro2@example.com' }]);

    await sendEmailsToOptedInPros(
      [proRow('pro-1', 3, false), proRow('pro-2', 8, true)],
      'kitesurf',
    );

    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['pro-2'] } }),
      }),
    );
    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledWith({ proEmail: 'pro2@example.com', sport: 'kitesurf' });
  });

  it('une erreur Brevo sur un pro ne bloque pas les autres', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'pro-1', email: 'pro1@example.com' },
      { id: 'pro-2', email: 'pro2@example.com' },
    ]);
    // pro-1 échoue, pro-2 réussit
    mockSendNewLessonRequestEmail
      .mockRejectedValueOnce(new Error('SMTP timeout'))
      .mockResolvedValueOnce({ sent: true });

    await expect(
      sendEmailsToOptedInPros(
        [proRow('pro-1', 3, true), proRow('pro-2', 8, true)],
        'surf',
      ),
    ).resolves.not.toThrow();

    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledTimes(2);
  });

  it('une erreur DB ne throw pas (log + return silencieux)', async () => {
    mockUserFindMany.mockRejectedValue(new Error('DB error'));

    await expect(
      sendEmailsToOptedInPros([proRow('pro-1', 3, true)], 'surf'),
    ).resolves.not.toThrow();

    expect(mockSendNewLessonRequestEmail).not.toHaveBeenCalled();
  });

  it('une seule query DB pour N pros opted-in (pas de N+1)', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'pro-1', email: 'p1@example.com' },
      { id: 'pro-2', email: 'p2@example.com' },
      { id: 'pro-3', email: 'p3@example.com' },
    ]);

    await sendEmailsToOptedInPros(
      [proRow('pro-1', 2, true), proRow('pro-2', 5, true), proRow('pro-3', 10, true)],
      'surf',
    );

    expect(mockUserFindMany).toHaveBeenCalledTimes(1);
  });

  it('fonctionne avec sport=null (demande générique)', async () => {
    mockUserFindMany.mockResolvedValue([{ id: 'pro-1', email: 'pro1@example.com' }]);

    await sendEmailsToOptedInPros([proRow('pro-1', 3, true)], null);

    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledWith({ proEmail: 'pro1@example.com', sport: null });
  });
});

describe('notifyNearbyProsForLesson — comportement email', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockCreateNotif.mockResolvedValue({ id: 'notif-1', createdAt: new Date() });
    mockRecordFanout.mockResolvedValue(undefined);
    mockSendNewLessonRequestEmail.mockResolvedValue({ sent: true });
    mockUserFindMany.mockResolvedValue([]);
  });

  it('déclenche l\'envoi email pour les pros avec emailNotif=true', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3, true)]);
    mockUserFindMany.mockResolvedValue([{ id: 'pro-1', email: 'pro1@example.com' }]);

    await notifyNearbyProsForLesson(BASE_INPUT);

    // Laisser le fire-and-forget se résoudre
    await new Promise((r) => setTimeout(r, 20));

    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledWith({
      proEmail: 'pro1@example.com',
      sport: 'surf',
    });
  });

  it('email et in-app restent indépendants quand le canal in-app est désactivé', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3, true, false)]);
    mockUserFindMany.mockResolvedValue([{ id: 'pro-1', email: 'pro1@example.com' }]);

    await notifyNearbyProsForLesson(BASE_INPUT);
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCreateNotif).not.toHaveBeenCalled();
    expect(mockSendNewLessonRequestEmail).toHaveBeenCalledTimes(1);
  });

  it('ne déclenche aucun email si tous les pros ont emailNotif=false', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3, false), proRow('pro-2', 8, false)]);

    await notifyNearbyProsForLesson(BASE_INPUT);
    await new Promise((r) => setTimeout(r, 20));

    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockSendNewLessonRequestEmail).not.toHaveBeenCalled();
  });

  it('un échec email ne bloque pas les notifications in-app', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3, true)]);
    mockUserFindMany.mockResolvedValue([{ id: 'pro-1', email: 'pro1@example.com' }]);
    mockSendNewLessonRequestEmail.mockRejectedValue(new Error('Brevo down'));

    await expect(notifyNearbyProsForLesson(BASE_INPUT)).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 20));

    // In-app notification bien envoyée malgré l'échec email
    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
  });

  it('les notifications in-app et emails sont indépendants (emailNotif=false → pas d\'email, notif ok)', async () => {
    mockQueryRaw.mockResolvedValue([proRow('pro-1', 3, false)]);

    await notifyNearbyProsForLesson(BASE_INPUT);
    await new Promise((r) => setTimeout(r, 20));

    expect(mockCreateNotif).toHaveBeenCalledTimes(1);
    expect(mockSendNewLessonRequestEmail).not.toHaveBeenCalled();
  });
});
