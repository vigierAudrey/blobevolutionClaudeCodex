import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });

import { randomUUID } from 'crypto';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createClient, type RedisClientType } from 'redis';
import { resolveRedisUrl } from '../lib/redisConfig';
import { runJobWithLogContext } from '../observability/log-context';
import { secureLogger } from '../utils/secure-logger';

/**
 * purgeNotifications — Job de purge TTL des notifications.
 *
 * Règle métier :
 *   Supprime les notifications créées il y a plus de NOTIFICATION_RETENTION_DAYS jours.
 *   Défaut : 90 jours. Min : 30. Max : 365.
 *
 * Sécurité :
 *   - Pas d'endpoint public : exécuté uniquement en CLI via cron VPS.
 *   - Cutoff calculé server-side : jamais fourni en paramètre externe.
 *   - Suppression par batch : évite les gros locks et les longues transactions.
 *   - Pas de PII dans les logs (counts uniquement).
 *   - DRY_RUN=true : log sans supprimer (garde-fou déploiement).
 *
 * Index requis :
 *   @@index([createdAt]) — ajouté en migration 20260519100000_notification_purge_index.
 *   Sans cet index, un DELETE WHERE createdAt < cutoff ferait un seq-scan.
 */

export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_BATCH_SIZE = 500;

const PURGE_JOB_LOCK_KEY = 'lock:jobs:purge-notifications';
const PURGE_JOB_LOCK_TTL_SECONDS = 15 * 60;

/**
 * Résout la durée de rétention depuis l'env NOTIFICATION_RETENTION_DAYS.
 * Clampée entre MIN_RETENTION_DAYS et MAX_RETENTION_DAYS.
 * Fallback DEFAULT_RETENTION_DAYS si absente ou invalide.
 */
export function resolveRetentionDays(): number {
  const raw = process.env.NOTIFICATION_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, parsed));
}

export interface PurgeNotificationsResult {
  deleted: number;
  batches: number;
  dryRun: boolean;
  retentionDays: number;
  cutoff: Date;
}

export interface PurgeNotificationsOptions {
  /** Date de référence (défaut : now). Injectable pour les tests. */
  now?: Date;
  /** Nombre de lignes supprimées par batch (défaut : DEFAULT_BATCH_SIZE). */
  batchSize?: number;
  /** Log sans supprimer si true. */
  dryRun?: boolean;
  /** Nombre de jours de rétention (override env). */
  retentionDays?: number;
}

/**
 * Purge des notifications expirées par batch.
 * Exportée pour les tests unitaires.
 */
export async function purgeOldNotifications(
  opts: PurgeNotificationsOptions = {},
): Promise<PurgeNotificationsResult> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const dryRun = opts.dryRun ?? false;
  const retentionDays = opts.retentionDays ?? resolveRetentionDays();

  // Arithmétique en ms pour éviter les dérives DST / timezone.
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let deleted = 0;
  let batches = 0;

  secureLogger.info('NOTIFICATIONS_PURGE_STARTED', {
    retentionDays,
    cutoff: cutoff.toISOString(),
    dryRun,
  });

  while (true) {
    // SELECT d'abord les ids (évite un lock long sur le DELETE full-scan).
    const batch = await prisma.notification.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: batchSize,
    });

    if (batch.length === 0) break;
    batches++;

    if (dryRun) {
      secureLogger.info('NOTIFICATIONS_PURGE_BATCH', {
        batch: batches,
        would_delete: batch.length,
        dryRun: true,
      });
      // Dry-run : on s'arrête après le premier batch pour éviter la boucle infinie.
      break;
    }

    const ids = batch.map((n: { id: string }) => n.id);
    const result = await prisma.notification.deleteMany({
      where: { id: { in: ids } },
    });
    deleted += result.count;

    secureLogger.info('NOTIFICATIONS_PURGE_BATCH', {
      batch: batches,
      deleted: result.count,
      total_deleted: deleted,
    });

    // Si le batch est inférieur à la taille max, c'est le dernier.
    if (batch.length < batchSize) break;
  }

  secureLogger.info('NOTIFICATIONS_PURGE_COMPLETED', {
    deleted,
    batches,
    retentionDays,
    dryRun,
  });

  return { deleted, batches, dryRun, retentionDays, cutoff };
}

// ─── Redis distributed lock ────────────────────────────────────────────────────

type PurgeJobLock = { client: RedisClientType; token: string };

async function acquirePurgeJobLock(): Promise<PurgeJobLock | null> {
  const redisClient = createClient({
    url: resolveRedisUrl(),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    socket: { connectTimeout: 4000, reconnectStrategy: () => false },
  });

  redisClient.on('error', (error: Error) => {
    secureLogger.error('NOTIFICATIONS_PURGE_REDIS_LOCK_ERROR', { message: error.message });
  });

  await redisClient.connect();

  const token = randomUUID();
  const acquired = await redisClient.set(PURGE_JOB_LOCK_KEY, token, {
    NX: true,
    EX: PURGE_JOB_LOCK_TTL_SECONDS,
  });

  if (acquired !== 'OK') {
    await redisClient.quit().catch(() => redisClient.disconnect());
    return null;
  }

  return { client: redisClient, token };
}

async function releasePurgeJobLock(lock: PurgeJobLock | null): Promise<void> {
  if (!lock) return;
  try {
    const currentToken = await lock.client.get(PURGE_JOB_LOCK_KEY);
    if (currentToken === lock.token) {
      await lock.client.del(PURGE_JOB_LOCK_KEY);
    }
  } finally {
    await lock.client.quit().catch(() => lock.client.disconnect());
  }
}

// ─── Script entry point ────────────────────────────────────────────────────────

async function main() {
  const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

  if (dryRun) {
    secureLogger.info('NOTIFICATIONS_PURGE_DRY_RUN_START', {});
  }

  await runJobWithLogContext('purge-notifications-cli', async () => {
    const shouldUseLock = process.env.NODE_ENV === 'production';
    const lock = shouldUseLock ? await acquirePurgeJobLock() : null;

    if (shouldUseLock && !lock) {
      secureLogger.info('NOTIFICATIONS_PURGE_SKIP_LOCK_HELD', {});
      return;
    }

    try {
      const result = await purgeOldNotifications({ dryRun });

      secureLogger.info('NOTIFICATIONS_PURGE_RUN_METRICS', {
        deleted: result.deleted,
        batches: result.batches,
        retention_days: result.retentionDays,
        dry_run: result.dryRun,
      });
    } catch (err: unknown) {
      secureLogger.error('NOTIFICATIONS_PURGE_FAILED', {
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      await releasePurgeJobLock(lock);
    }
  });
}

if (require.main === module) {
  main()
    .catch((e) => {
      secureLogger.error('NOTIFICATIONS_PURGE_FAILED', {
        message: e instanceof Error ? e.message : String(e),
      });
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
