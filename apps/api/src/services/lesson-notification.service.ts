import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { cacheService } from './cache.service';
import { createNotificationSilent, NotificationType } from './notification.service';
import { secureLogger } from '../utils/secure-logger';

/** Max pros notifiés par demande de cours (cap dur MVP). */
export const MAX_PROS_TO_NOTIFY = 100;

/** Durée du cooldown anti-spam par rider (secondes). */
export const FANOUT_COOLDOWN_TTL_SECONDS = 3600; // 1 heure

/** Sports supportés. */
type LessonSport = 'surf' | 'kitesurf';

export interface LessonNotificationInput {
  riderId: string;
  lessonLat: number;
  lessonLng: number;
  lessonSport: LessonSport | null;
}

interface EligibleProRow {
  userId: string;
  distanceKm: number;
}

function toDistanceBucket(km: number): string {
  if (km < 5) return '<5km';
  if (km < 15) return '5-15km';
  if (km < 30) return '15-30km';
  return '>30km';
}

/** Clé Redis anti-spam fanout par rider. */
function fanoutKey(riderId: string): string {
  return `lesson_fanout:${riderId}`;
}

/**
 * Vérifie si le cooldown anti-spam est actif pour ce rider.
 * Fail-open : si Redis indisponible, on laisse passer (résilience > anti-spam parfait).
 */
async function isFanoutCoolingDown(riderId: string): Promise<boolean> {
  const redis = cacheService.getClient();
  if (!redis) return false;
  try {
    const val = await redis.get(fanoutKey(riderId));
    return val !== null;
  } catch {
    return false;
  }
}

async function markFanoutSent(riderId: string): Promise<void> {
  const redis = cacheService.getClient();
  if (!redis) return;
  try {
    await redis.set(fanoutKey(riderId), '1', { EX: FANOUT_COOLDOWN_TTL_SECONDS });
  } catch {
    // non-bloquant
  }
}

/**
 * Trouve les pros éligibles via PostGIS.
 *
 * Conditions :
 *   - ProProfile.verified = true
 *   - ProProfile.lat + lng non-null (position de service définie)
 *   - Distance(pro, lessonLocation) <= pro.radiusKm
 *   - NotificationPreferences.notifyLessonRequests = true (ou absent = défaut true)
 *   - Si lessonSport fourni : filtre sur notifyForSurf / notifyForKitesurf
 *
 * Sécurité : paramètres liés via Prisma.sql (injection SQL impossible).
 * Performance : cap LIMIT MAX_PROS_TO_NOTIFY — jamais de scan complet en mémoire.
 * Privacy : distanceKm calculé côté serveur, arrondi avant envoi.
 */
async function findEligiblePros(input: LessonNotificationInput): Promise<EligibleProRow[]> {
  const { lessonLat, lessonLng, lessonSport } = input;

  // Filtre sport : si null → pas de filtre sport (on notifie tous les pros éligibles par périmètre)
  const sportFilter =
    lessonSport === 'surf'
      ? Prisma.sql`AND (np."notifyForSurf" IS NULL OR np."notifyForSurf" = true)`
      : lessonSport === 'kitesurf'
        ? Prisma.sql`AND (np."notifyForKitesurf" IS NULL OR np."notifyForKitesurf" = true)`
        : Prisma.sql``;

  const rows = await prisma.$queryRaw<EligibleProRow[]>(Prisma.sql`
    SELECT
      pp."userId",
      ROUND(
        ST_Distance(
          ST_SetSRID(ST_MakePoint(pp."lng", pp."lat"), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${lessonLng}, ${lessonLat}), 4326)::geography
        ) / 1000.0
      )::float AS "distanceKm"
    FROM "ProProfile" pp
    LEFT JOIN "NotificationPreferences" np ON np."userId" = pp."userId"
    WHERE pp."verified" = true
      AND pp."lat" IS NOT NULL
      AND pp."lng" IS NOT NULL
      AND (np."notifyLessonRequests" IS NULL OR np."notifyLessonRequests" = true)
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(pp."lng", pp."lat"), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${lessonLng}, ${lessonLat}), 4326)::geography,
        pp."radiusKm" * 1000.0
      )
      ${sportFilter}
    ORDER BY "distanceKm" ASC
    LIMIT ${MAX_PROS_TO_NOTIFY}
  `);

  return rows;
}

/**
 * Notifie les pros éligibles pour une demande de cours.
 *
 * Sécurité :
 *   - riderId extrait du JWT server-side (jamais du body client)
 *   - Le serveur calcule les pros, aucun control rider sur recipientId
 *   - Anti-spam via cooldown Redis 1h par rider
 *   - Cap dur MAX_PROS_TO_NOTIFY = 100
 *   - Pas de coordonnées exactes dans le payload de notification
 */
export async function notifyNearbyProsForLesson(input: LessonNotificationInput): Promise<void> {
  const { riderId, lessonSport } = input;

  // Cooldown anti-spam : un rider ne peut déclencher la fanout qu'une fois par heure.
  const coolingDown = await isFanoutCoolingDown(riderId);
  if (coolingDown) {
    secureLogger.debug('LESSON_NOTIF_FANOUT_SKIPPED_COOLDOWN', { riderId });
    return;
  }

  let pros: EligibleProRow[];
  try {
    pros = await findEligiblePros(input);
  } catch (err: unknown) {
    secureLogger.error('LESSON_NOTIF_FIND_PROS_FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (pros.length === 0) {
    secureLogger.debug('LESSON_NOTIF_NO_ELIGIBLE_PROS', {});
    return;
  }

  secureLogger.info('LESSON_NOTIF_FANOUT_START', { proCount: pros.length });

  // Marquer le cooldown avant l'envoi pour éviter un double-fanout concurrent.
  await markFanoutSent(riderId);

  const sportLabel = lessonSport ?? 'cours';
  const title = 'Nouvelle demande de cours près de vous';
  const body = `Un rider cherche un prof de ${sportLabel} dans votre secteur.`;

  for (const pro of pros) {
    const distanceBucket = toDistanceBucket(Number(pro.distanceKm));

    createNotificationSilent({
      userId: pro.userId,
      type: NotificationType.LESSON_REQUEST_NEARBY,
      title,
      body,
      url: '/pro/map',
      data: {
        // riderProfileRef : référence au profil du rider, PAS un requestId.
        // Il n'existe pas encore de modèle LessonRequest dédié ; ce champ
        // sera renommé requestId dès qu'un tel modèle existera.
        riderProfileRef: riderId,
        sport: lessonSport ?? null,
        distanceBucket,
      },
    });
  }

  secureLogger.info('LESSON_NOTIF_FANOUT_DONE', { notified: pros.length });
}

/**
 * Wrapper fire-and-forget : ne bloque pas la réponse HTTP du rider.
 * Erreurs loguées sans throw.
 */
export function notifyNearbyProsForLessonSilent(input: LessonNotificationInput): void {
  void notifyNearbyProsForLesson(input).catch((err: unknown) => {
    secureLogger.warn('LESSON_NOTIF_FANOUT_FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
