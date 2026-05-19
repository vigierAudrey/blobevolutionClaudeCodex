import { clientPrisma as prisma } from '@blobinfini/database';
import {
  CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_DATE,
  CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_VERSION,
  CONVERSATION_BLOCK_LEGACY_BATCH_ID,
} from '../apps/api/src/modules/admin/moderation-history.constants';

type BackfillOptions = {
  repair?: boolean;
};

type BackfillResult = {
  reliableSinceDate: string;
  reliableSinceVersion: string;
  batchId: string;
  processed: number;
  inserted: number;
  skipped: number;
  alreadyBackfilled: boolean;
};

export async function runConversationBlockLegacyBackfill(
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const repair = options.repair === true;

  const existingBatchCount = await prisma.conversationBlockEvent.count({
    where: {
      source: 'LEGACY_UNKNOWN',
      batchId: CONVERSATION_BLOCK_LEGACY_BATCH_ID,
    },
  });

  if (existingBatchCount > 0 && !repair) {
    return {
      reliableSinceDate: CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_DATE,
      reliableSinceVersion: CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_VERSION,
      batchId: CONVERSATION_BLOCK_LEGACY_BATCH_ID,
      processed: 0,
      inserted: 0,
      skipped: existingBatchCount,
      alreadyBackfilled: true,
    };
  }

  const blockedMembers = await prisma.conversationMember.findMany({
    where: { blockedAt: { not: null } },
    select: {
      conversationId: true,
      userId: true,
      blockedAt: true,
    },
    orderBy: [{ blockedAt: 'asc' }, { id: 'asc' }],
  });

  const existingEvents = await prisma.conversationBlockEvent.findMany({
    where: {
      source: 'LEGACY_UNKNOWN',
      batchId: CONVERSATION_BLOCK_LEGACY_BATCH_ID,
    },
    select: {
      conversationId: true,
      userId: true,
    },
  });

  const existingKeys = new Set(
    existingEvents.map((item) => `${item.conversationId}:${item.userId}`),
  );

  const missingRows = blockedMembers
    .filter((member) => !existingKeys.has(`${member.conversationId}:${member.userId}`))
    .map((member) => ({
      conversationId: member.conversationId,
      userId: member.userId,
      actorUserId: null,
      actorType: 'SYSTEM' as const,
      action: 'BLOCK' as const,
      source: 'LEGACY_UNKNOWN' as const,
      batchId: CONVERSATION_BLOCK_LEGACY_BATCH_ID,
      reason: null,
      createdAt: member.blockedAt ?? new Date(),
    }));

  const inserted = missingRows.length > 0
    ? (await prisma.conversationBlockEvent.createMany({ data: missingRows })).count
    : 0;

  return {
    reliableSinceDate: CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_DATE,
    reliableSinceVersion: CONVERSATION_BLOCK_HISTORY_RELIABLE_SINCE_VERSION,
    batchId: CONVERSATION_BLOCK_LEGACY_BATCH_ID,
    processed: blockedMembers.length,
    inserted,
    skipped: blockedMembers.length - inserted,
    alreadyBackfilled: false,
  };
}

if (require.main === module) {
  const repair = process.argv.includes('--repair');

  runConversationBlockLegacyBackfill({ repair })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
