import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });

import { randomUUID } from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createClient, type RedisClientType } from 'redis';
import { resolveRedisUrl } from '../lib/redisConfig';
import { runJobWithLogContext } from '../observability/log-context';
import { secureLogger } from '../utils/secure-logger';
import { createNotificationSilent } from '../services/notification.service';

/**
 * expireLessonRequests — Job d'expiration des demandes de cours (BloboMap).
 *
 * Règles métier :
 *   1. wantsLesson=true ET lessonDate < aujourd'hui (UTC) → désactivation.
 *      La demande visait un jour précis désormais passé : la laisser active
 *      pollue la BloboMap et fait perdre du temps aux pros.
 *   2. wantsLesson=true ET lessonDate=null ET updatedAt < now - TTL (défaut 30 j)
 *      → désactivation. Sans date, une demande serait immortelle par construction.
 *
 * Effets :
 *   - wantsLesson=false + lessonLat/lessonLng effacés (même invariant que la
 *     désactivation manuelle : pas de coordonnées orphelines en DB).
 *   - lessonSport/lessonLevel/lessonPlace/lessonDate conservés : le rider
 *     retrouve sa config s'il renouvelle.
 *   - Notification in-app au rider (type SYSTEM, lien /lesson-request) pour
 *     l'inviter à renouveler — levier de réengagement.
 *
 * Sécurité :
 *   - Pas d'endpoint public : exécuté en interne (setInterval) ou en CLI via cron.
 *   - Cutoffs calculés server-side : jamais fournis en paramètre externe.
 *   - Batch : évite les gros locks et les longues transactions.
 *   - Pas de PII dans les logs (counts uniquement).
 *   - DRY_RUN=true : log sans modifier (garde-fou déploiement).
 */

export const DEFAULT_DATELESS_TTL_DAYS = 30;
export const MIN_DATELESS_TTL_DAYS = 7;
export const MAX_DATELESS_TTL_DAYS = 365;
export const DEFAULT_BATCH_SIZE = 200;

const EXPIRY_JOB_LOCK_KEY = 'lock:jobs:expire-lesson-requests';
const EXPIRY_JOB_LOCK_TTL_SECONDS = 15 * 60;

/**
 * Résout le TTL des demandes sans date depuis l'env LESSON_DATELESS_TTL_DAYS.
 * Clampé entre MIN_DATELESS_TTL_DAYS et MAX_DATELESS_TTL_DAYS.
 * Fallback DEFAULT_DATELESS_TTL_DAYS si absente ou invalide.
 */
export function resolveDatelessTtlDays(): number {
  const raw = process.env.LESSON_DATELESS_TTL_DAYS;
  if (!raw) return DEFAULT_DATELESS_TTL_DAYS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DATELESS_TTL_DAYS;
  return Math.max(MIN_DATELESS_TTL_DAYS, Math.min(MAX_DATELESS_TTL_DAYS, parsed));
}

/** Minuit UTC du jour de `now` — une demande datée d'aujourd'hui reste active. */
export function startOfTodayUtc(now: Date): Date {
  return new Date(now.toISOString().slice(0, 10));
}

export interface ExpireLessonRequestsResult {
  expiredDated: number;
  expiredDateless: number;
  batches: number;
  dryRun: boolean;
  datelessTtlDays: number;
}

export interface ExpireLessonRequestsOptions {
  /** Date de référence (défaut : now). Injectable pour les tests. */
  now?: Date;
  /** Nombre de profils traités par batch (défaut : DEFAULT_BATCH_SIZE). */
  batchSize?: number;
  /** Log sans modifier si true. */
  dryRun?: boolean;
  /** TTL en jours des demandes sans date (override env). */
  datelessTtlDays?: number;
}

interface ExpiredRow {
  id: string;
  userId: string;
}

async function expireBatchLoop(
  where: Record<string, unknown>,
  batchSize: number,
  dryRun: boolean,
  logLabel: string,
  onBatch: (count: number) => void,
): Promise<{ expired: number; batches: number; userIds: string[] }> {
  let expired = 0;
  let batches = 0;
  const userIds: string[] = [];

  while (true) {
    const batch: ExpiredRow[] = await prisma.riderProfile.findMany({
      where,
      select: { id: true, userId: true },
      take: batchSize,
    });

    if (batch.length === 0) break;
    batches++;

    if (dryRun) {
      secureLogger.info(logLabel, { batch: batches, would_expire: batch.length, dryRun: true });
      // Dry-run : on s'arrête après le premier batch — rien n'est modifié,
      // la boucle relirait indéfiniment les mêmes lignes.
      break;
    }

    const ids = batch.map((r) => r.id);
    const result = await prisma.riderProfile.updateMany({
      where: { id: { in: ids } },
      data: { wantsLesson: false, lessonLat: null, lessonLng: null },
    });
    expired += result.count;
    userIds.push(...batch.map((r) => r.userId));

    secureLogger.info(logLabel, { batch: batches, expired: result.count, total_expired: expired });
    onBatch(result.count);

    if (batch.length < batchSize) break;
  }

  return { expired, batches, userIds };
}

/**
 * Expire les demandes de cours périmées par batch.
 * Exportée pour les tests unitaires.
 */
export async function expireLessonRequests(
  opts: ExpireLessonRequestsOptions = {},
): Promise<ExpireLessonRequestsResult> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const dryRun = opts.dryRun ?? false;
  const datelessTtlDays = opts.datelessTtlDays ?? resolveDatelessTtlDays();

  const dateCutoff = startOfTodayUtc(now);
  // Arithmétique en ms pour éviter les dérives DST / timezone.
  const datelessCutoff = new Date(now.getTime() - datelessTtlDays * 24 * 60 * 60 * 1000);

  secureLogger.info('LESSON_EXPIRY_STARTED', {
    dateCutoff: dateCutoff.toISOString(),
    datelessCutoff: datelessCutoff.toISOString(),
    datelessTtlDays,
    dryRun,
  });

  let totalBatches = 0;
  const bumpBatches = () => { totalBatches++; };

  // 1. Demandes dont la date souhaitée est passée.
  const dated = await expireBatchLoop(
    { wantsLesson: true, lessonDate: { lt: dateCutoff } },
    batchSize,
    dryRun,
    'LESSON_EXPIRY_DATED_BATCH',
    bumpBatches,
  );

  // 2. Demandes sans date inactives depuis plus de datelessTtlDays.
  const dateless = await expireBatchLoop(
    { wantsLesson: true, lessonDate: null, updatedAt: { lt: datelessCutoff } },
    batchSize,
    dryRun,
    'LESSON_EXPIRY_DATELESS_BATCH',
    bumpBatches,
  );

  // Notification in-app aux riders concernés — fire-and-forget, gatée par les
  // préférences (shouldNotifyUser IN_APP). Un échec de notif ne bloque pas le job.
  if (!dryRun) {
    for (const userId of [...dated.userIds, ...dateless.userIds]) {
      createNotificationSilent({
        userId,
        type: 'SYSTEM',
        title: 'Ta demande de cours a expiré',
        body: 'Elle n’est plus visible des moniteurs sur la BloboMap. Renouvelle-la en deux clics si tu cherches toujours un cours.',
        url: '/lesson-request',
      });
    }
  }

  const result: ExpireLessonRequestsResult = {
    expiredDated: dated.expired,
    expiredDateless: dateless.expired,
    batches: dated.batches + dateless.batches,
    dryRun,
    datelessTtlDays,
  };

  secureLogger.info('LESSON_EXPIRY_COMPLETED', {
    expired_dated: result.expiredDated,
    expired_dateless: result.expiredDateless,
    batches: result.batches,
    dryRun,
  });

  return result;
}

// ─── Redis distributed lock ────────────────────────────────────────────────────

type ExpiryJobLock = { client: RedisClientType; token: string };

async function acquireExpiryJobLock(): Promise<ExpiryJobLock | null> {
  const redisClient = createClient({
    url: resolveRedisUrl(),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    socket: { connectTimeout: 4000, reconnectStrategy: () => false },
  });

  redisClient.on('error', (error: Error) => {
    secureLogger.error('LESSON_EXPIRY_REDIS_LOCK_ERROR', { message: error.message });
  });

  await redisClient.connect();

  const token = randomUUID();
  const acquired = await redisClient.set(EXPIRY_JOB_LOCK_KEY, token, {
    NX: true,
    EX: EXPIRY_JOB_LOCK_TTL_SECONDS,
  });

  if (acquired !== 'OK') {
    await redisClient.quit().catch(() => redisClient.disconnect());
    return null;
  }

  return { client: redisClient, token };
}

async function releaseExpiryJobLock(lock: ExpiryJobLock | null): Promise<void> {
  if (!lock) return;
  try {
    const currentToken = await lock.client.get(EXPIRY_JOB_LOCK_KEY);
    if (currentToken === lock.token) {
      await lock.client.del(EXPIRY_JOB_LOCK_KEY);
    }
  } finally {
    await lock.client.quit().catch(() => lock.client.disconnect());
  }
}

// ─── Script entry point ────────────────────────────────────────────────────────

async function main() {
  const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

  await runJobWithLogContext('expire-lesson-requests-cli', async () => {
    const shouldUseLock = process.env.NODE_ENV === 'production';
    const lock = shouldUseLock ? await acquireExpiryJobLock() : null;

    if (shouldUseLock && !lock) {
      secureLogger.info('LESSON_EXPIRY_SKIP_LOCK_HELD', {});
      return;
    }

    try {
      const result = await expireLessonRequests({ dryRun });

      secureLogger.info('LESSON_EXPIRY_RUN_METRICS', {
        expired_dated: result.expiredDated,
        expired_dateless: result.expiredDateless,
        batches: result.batches,
        dateless_ttl_days: result.datelessTtlDays,
        dry_run: result.dryRun,
      });
    } catch (err: unknown) {
      secureLogger.error('LESSON_EXPIRY_FAILED', {
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      await releaseExpiryJobLock(lock);
    }
  });
}

if (require.main === module) {
  main()
    .catch((e) => {
      secureLogger.error('LESSON_EXPIRY_FAILED', {
        message: e instanceof Error ? e.message : String(e),
      });
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
