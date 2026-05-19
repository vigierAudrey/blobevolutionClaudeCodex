import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });

import { randomUUID } from 'crypto';
import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { createClient } from 'redis';
import { resolveRedisUrl } from '../lib/redisConfig';
import { runJobWithLogContext } from '../observability/log-context';
import { secureLogger } from '../utils/secure-logger';

/**
 * purgeConversations — Job quotidien de purge des conversations expirées.
 *
 * Règles métier :
 *   - Archives  (archivedAt IS NOT NULL) : purgeAt = archivedAt + 18 mois
 *   - Corbeille (trashedAt IS NOT NULL)  : purgeAt = trashedAt  + 30 jours
 *
 * DEUX chemins de purge :
 *   1. purgeAt IS NOT NULL AND purgeAt <= now
 *      → enregistrements dont purgeAt a été posé (post-migration).
 *   2. trashedAt IS NOT NULL AND purgeAt IS NULL AND trashedAt <= now - 30j
 *      → legacy : trashés avant migration, sans purgeAt. Branche à retirer ~6 mois post-migration.
 *
 * Sécurité :
 *   - Jamais de suppression sans condition de date explicite.
 *   - count + deleteConversation dans une transaction (anti-TOCTOU).
 *   - Traitement par batch (200 membres/passe) — borne les locks.
 *   - Aucune PII dans les logs (counts uniquement).
 *   - DRY_RUN=true : log sans supprimer (garde-fou déploiement).
 *
 * Cascade Prisma (schema) :
 *   Conversation → onDelete: Cascade → Message, ConversationMember,
 *                                       ConversationInvitation, ContactRequest
 */

/** Days after which a trashed conversation member is hard-deleted. */
export const TRASH_PURGE_DAYS = 30;

export interface PurgeConversationsResult {
  membersDeleted: number;
  conversationsDeleted: number;
  passes: number;
  dryRun: boolean;
}

export interface PurgeConversationsOptions {
  /** Date reference (default: now). Injectable for tests. */
  now?: Date;
  /** Max members to delete per pass (default: 200). */
  batchSize?: number;
  /** If true, log what would be deleted without performing any deletion. */
  dryRun?: boolean;
}

const PURGE_JOB_LOCK_KEY = 'lock:jobs:purge-conversations';
const PURGE_JOB_LOCK_TTL_SECONDS = 15 * 60;

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * After deleting a batch of members, check each affected conversation.
 * If no member remains → delete the conversation atomically (TOCTOU-safe).
 */
async function maybeDeleteOrphanedConversations(
  conversationIds: string[],
  accumulator: { conversationsDeleted: number },
): Promise<void> {
  for (const conversationId of conversationIds) {
    const deleted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const remainingCount = await tx.conversationMember.count({
        where: { conversationId },
      });
      if (remainingCount > 0) return 0;

      const result = await tx.conversation.deleteMany({
        where: { id: conversationId },
      });
      return result.count;
    });
    accumulator.conversationsDeleted += deleted;
  }
}

function uniqueConversationIds(rows: { conversationId: string }[]): string[] {
  return [...new Set(rows.map((m) => m.conversationId))];
}

// ─── Core purge function ───────────────────────────────────────────────────────

/**
 * Core purge function — exported for unit/integration testing.
 *
 * Pass 1: members where purgeAt IS NOT NULL AND purgeAt <= now.
 * Pass 2 (legacy): members where trashedAt IS NOT NULL AND purgeAt IS NULL AND trashedAt <= now - 30d.
 */
export async function purgeDueConversationMembers(
  opts: PurgeConversationsOptions = {},
): Promise<PurgeConversationsResult> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? 200;
  const dryRun = opts.dryRun ?? false;

  if (now <= new Date(0)) throw new Error('Invalid now date');

  const acc = { membersDeleted: 0, conversationsDeleted: 0, passes: 0 };

  // ── Pass 1: explicit purgeAt (archives + new trashed) ────────────────────
  while (true) {
    const expired = await prisma.conversationMember.findMany({
      where: { purgeAt: { not: null, lte: now } },
      select: { id: true, conversationId: true },
      take: batchSize,
    });

    if (expired.length === 0) break;
    acc.passes += 1;

    if (dryRun) {
      secureLogger.info('chat.purge.dry_run.pass1', {
        would_delete_members: expired.length,
        conversation_count: uniqueConversationIds(expired).length,
      });
      // Advance virtual cursor: mark as seen by not re-querying the same rows.
      // In dry-run we stop after the first batch to avoid infinite loop.
      break;
    }

    const memberIds = expired.map((m: { id: string }) => m.id);
    const convIds = uniqueConversationIds(expired);

    const del = await prisma.conversationMember.deleteMany({
      where: { id: { in: memberIds } },
    });
    acc.membersDeleted += del.count;

    await maybeDeleteOrphanedConversations(convIds, acc);
  }

  // ── Pass 2 (legacy): trashed without purgeAt older than TRASH_PURGE_DAYS ──
  const trashedCutoff = new Date(now);
  trashedCutoff.setDate(trashedCutoff.getDate() - TRASH_PURGE_DAYS);

  while (true) {
    const legacyTrashed = await prisma.conversationMember.findMany({
      where: {
        trashedAt: { not: null, lte: trashedCutoff },
        purgeAt: null,
      },
      select: { id: true, conversationId: true },
      take: batchSize,
    });

    if (legacyTrashed.length === 0) break;
    acc.passes += 1;

    if (dryRun) {
      secureLogger.info('chat.purge.dry_run.pass2_legacy', {
        would_delete_members: legacyTrashed.length,
        conversation_count: uniqueConversationIds(legacyTrashed).length,
      });
      break;
    }

    const memberIds = legacyTrashed.map((m: { id: string }) => m.id);
    const convIds = uniqueConversationIds(legacyTrashed);

    const del = await prisma.conversationMember.deleteMany({
      where: { id: { in: memberIds } },
    });
    acc.membersDeleted += del.count;

    await maybeDeleteOrphanedConversations(convIds, acc);
  }

  return { membersDeleted: acc.membersDeleted, conversationsDeleted: acc.conversationsDeleted, passes: acc.passes, dryRun };
}

// ─── Redis distributed lock ────────────────────────────────────────────────────

type PurgeJobLock = { client: ReturnType<typeof createClient>; token: string };

async function acquirePurgeJobLock(): Promise<PurgeJobLock | null> {
  const redisClient = createClient({
    url: resolveRedisUrl(),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    socket: { connectTimeout: 4000, reconnectStrategy: () => false },
  });

  redisClient.on('error', (error: Error) => {
    secureLogger.error('chat.purge.redis_lock_error', { message: error.message });
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
    secureLogger.info('chat.purge.dry_run.start', {});
  }

  await runJobWithLogContext('purge-conversations-cli', async () => {
    const shouldUseLock = process.env.NODE_ENV === 'production';
    const lock = shouldUseLock ? await acquirePurgeJobLock() : null;

    if (shouldUseLock && !lock) {
      secureLogger.info('chat.purge.skip_lock_held', {});
      return;
    }

    try {
      const result = await purgeDueConversationMembers({ dryRun });

      secureLogger.info('chat.purge.run_metrics', {
        purged_members: result.membersDeleted,
        purged_conversations: result.conversationsDeleted,
        passes: result.passes,
        dry_run: result.dryRun,
      });
    } finally {
      await releasePurgeJobLock(lock);
    }
  });
}

if (require.main === module) {
  main()
    .catch((e) => {
      secureLogger.error('chat.purge.job_failed', { message: e instanceof Error ? e.message : String(e) });
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
