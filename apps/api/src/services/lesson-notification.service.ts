import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { cacheService } from './cache.service';
import { createNotification, NotificationType } from './notification.service';
import { hashRiderRef, makeLessonRequestId, recordFanout, type FanoutTriggerReason } from './lesson-fanout.repository';
import type { NotificationRow } from './notification.service';
import { secureLogger } from '../utils/secure-logger';
import { computeZoneLarge } from './analytics/events.service';
import { sendNewLessonRequestEmailToPro } from '../lib/mailer';
import { hashEmail } from '../modules/auth/login-attempt.util';

/** Max pros notifiés par demande de cours (cap dur MVP). */
export const MAX_PROS_TO_NOTIFY = 100;

/** Max emails envoyés en parallèle : respecte les limites Brevo et le pool SMTP. */
export const EMAIL_CONCURRENCY = 5;

/**
 * Taille des lots pour les inserts de notifications.
 *
 * Justification (Point 6) :
 *   MAX_PROS_TO_NOTIFY = 100. Sans chunking, 100 Promise.allSettled() concurrents
 *   = 100 connexions DB simultanées. Prisma pool par défaut = min(cpuCount*2+1, 10).
 *   → 90 promesses se retrouvent en file d'attente et peuvent expirer si le pool
 *   est saturé par d'autres requêtes concurrent (matching, chat…).
 *
 *   Chunking par 10 : max 10 INSERTs simultanés → respecte le pool sans saturer.
 *   Coût : 10 rounds × RTT pour 100 pros. Acceptable car le fanout est fire-and-forget
 *   (notifyNearbyProsForLessonSilent ne bloque pas la réponse HTTP rider).
 */
export const NOTIFICATION_CHUNK_SIZE = 10;

/** Durée du cooldown anti-spam par rider (secondes). */
export const FANOUT_COOLDOWN_TTL_SECONDS = 3600; // 1 heure

/** Sports supportés. */
type LessonSport = 'surf' | 'kitesurf';

export interface LessonNotificationInput {
  riderId: string;
  lessonLat: number;
  lessonLng: number;
  lessonSport: LessonSport | null;
  // Raison du déclenchement — optionnel (défaut MANUAL) pour rétro-compatibilité tests.
  triggerReason?: FanoutTriggerReason;
}

interface EligibleProRow {
  userId: string;
  distanceKm: number;
  emailNotif: boolean;
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
 * Envoie les notifications par lots de NOTIFICATION_CHUNK_SIZE.
 * Évite de saturer le pool Prisma avec MAX_PROS_TO_NOTIFY inserts simultanés.
 */
async function sendNotificationsChunked(
  pros: EligibleProRow[],
  buildInput: (pro: EligibleProRow) => Parameters<typeof createNotification>[0],
): Promise<PromiseSettledResult<NotificationRow>[]> {
  const all: PromiseSettledResult<NotificationRow>[] = [];
  for (let i = 0; i < pros.length; i += NOTIFICATION_CHUNK_SIZE) {
    const chunk = pros.slice(i, i + NOTIFICATION_CHUNK_SIZE);
    const results = await Promise.allSettled(chunk.map((pro) => createNotification(buildInput(pro))));
    all.push(...results);
  }
  return all;
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
      )::float AS "distanceKm",
      pp."emailNotif"
    FROM "ProProfile" pp
    LEFT JOIN "NotificationPreferences" np ON np."userId" = pp."userId"
    WHERE pp."verified" = true
      AND pp."lat" IS NOT NULL
      AND pp."lng" IS NOT NULL
      AND (np."notifyLessonRequests" IS NULL OR np."notifyLessonRequests" = true)
      AND (np."inAppEnabled" IS NULL OR np."inAppEnabled" = true)
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
 * Envoie les emails aux pros ayant emailNotif=true, en lots de EMAIL_CONCURRENCY.
 *
 * Sécurité :
 *   - proEmail relu depuis la DB server-side (jamais du client)
 *   - hashEmail utilisé dans les logs, jamais l'adresse en clair
 *   - Une erreur Brevo sur un pro ne bloque pas les autres
 *   - Fire-and-forget : n'impacte pas la réponse HTTP rider
 *
 * Performance :
 *   - Une seule query findMany pour tous les emails (pas de N+1)
 *   - Concurrence limitée à EMAIL_CONCURRENCY = 5
 *   - Ne s'exécute que si au moins un pro a emailNotif=true
 */
export async function sendEmailsToOptedInPros(
  pros: EligibleProRow[],
  sport: string | null,
): Promise<void> {
  const optedIn = pros.filter((p) => p.emailNotif);
  if (optedIn.length === 0) return;

  const proIds = optedIn.map((p) => p.userId);

  // Batch fetch des emails — un seul aller/retour DB, select minimal.
  let users: { id: string; email: string }[];
  try {
    users = await prisma.user.findMany({
      where: { id: { in: proIds } },
      select: { id: true, email: true },
    });
  } catch (err: unknown) {
    secureLogger.error('LESSON_EMAIL_FETCH_PROS_FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const emailMap = new Map(users.map((u) => [u.id, u.email]));

  // Envoi par lots de EMAIL_CONCURRENCY.
  for (let i = 0; i < optedIn.length; i += EMAIL_CONCURRENCY) {
    const chunk = optedIn.slice(i, i + EMAIL_CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async (pro) => {
        const proEmail = emailMap.get(pro.userId);
        if (!proEmail) return;
        try {
          await sendNewLessonRequestEmailToPro({ proEmail, sport });
        } catch (err: unknown) {
          // Log neutre : email hashé, pas de PII en clair.
          secureLogger.warn('LESSON_EMAIL_SEND_FAILED', {
            proEmailHash: hashEmail(proEmail),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }
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

  // lessonRequestId : sha256(riderId + UTC-date)[:16] — stable sur la journée.
  // COUNT(DISTINCT lessonRequestId) = riders uniques, pas fanouts bruts.
  const riderRef = hashRiderRef(riderId);
  const lessonRequestId = makeLessonRequestId(riderId);

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
    await recordFanout({
      riderRef,
      lessonRequestId,
      sport: lessonSport ?? null,
      prosFound: 0,
      prosNotified: 0,
      failureCount: 0,
      triggerReason: input.triggerReason ?? 'MANUAL',
      zoneLarge: computeZoneLarge(input.lessonLat, input.lessonLng),
    });
    return;
  }

  secureLogger.info('LESSON_NOTIF_FANOUT_START', { proCount: pros.length });

  // Marquer le cooldown avant l'envoi pour éviter un double-fanout concurrent.
  await markFanoutSent(riderId);

  const sportLabel = lessonSport ?? 'cours';
  const title = 'Nouvelle demande de cours près de vous';
  const body = `Un rider cherche un prof de ${sportLabel} dans votre secteur.`;

  // Envoi par lots de NOTIFICATION_CHUNK_SIZE : évite de saturer le pool Prisma.
  // fire-and-forget côté HTTP rider → la latence additionnelle est invisible.
  const results = await sendNotificationsChunked(pros, (pro) => ({
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
      distanceBucket: toDistanceBucket(Number(pro.distanceKm)),
      // lessonRequestId : sha256(riderId+UTC-date)[:16] — stable par rider-jour.
      // Permet de corréler les notifications LESSON_REQUEST_NEARBY au funnel
      // LessonFanout → ContactRequest dans les métriques admin (Sprint C10).
      // Non-PII : valeur hashée, non réversible, non exposée côté client.
      lessonRequestId,
    },
  }));

  const notified = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  if (failed > 0) {
    secureLogger.warn('LESSON_NOTIF_PARTIAL_FAILURE', { notified, failed });
  }

  secureLogger.info('LESSON_NOTIF_FANOUT_DONE', { notified });

  // Envoi emails aux pros ayant emailNotif=true — fire-and-forget.
  // Une erreur Brevo ne bloque pas et ne casse pas la demande rider.
  void sendEmailsToOptedInPros(pros, lessonSport).catch((err: unknown) => {
    secureLogger.warn('LESSON_EMAIL_FANOUT_FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  await recordFanout({
    riderRef,
    lessonRequestId,
    sport: lessonSport ?? null,
    prosFound: pros.length,
    prosNotified: notified,
    failureCount: failed,
    triggerReason: input.triggerReason ?? 'MANUAL',
    zoneLarge: computeZoneLarge(input.lessonLat, input.lessonLng),
  });
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
