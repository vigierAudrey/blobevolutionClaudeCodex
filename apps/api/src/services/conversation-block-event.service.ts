import crypto from 'crypto';
import {
  clientPrisma as prisma,
  Prisma,
} from '@blobinfini/database';
import { withTransactionRetry } from '../utils/transaction-retry';
import { secureLogger } from '../utils/secure-logger';

const DEFAULT_BULK_CHUNK_SIZE = 500;
const DEFAULT_BULK_MAX_SYNC = 5000;

class ConversationBlockEventServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'STATE_CONFLICT' | 'BULK_TOO_LARGE' | 'BULK_CONFLICT_RETRYABLE',
    public readonly details?: Record<string, string | number>,
  ) {
    super(message);
    this.name = 'ConversationBlockEventServiceError';
  }
}

type BlockAction = 'block' | 'unblock';
type BlockActorType = 'USER' | 'ADMIN' | 'SYSTEM';
type BlockSource = 'USER_SELF' | 'ADMIN_SINGLE' | 'ADMIN_BULK' | 'LEGACY_UNKNOWN';

type MemberWithUser = Prisma.ConversationMemberGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        email: true;
        role: true;
      };
    };
  };
}>;

type BlockedChunkItem = { id: string };
type BlockedMemberRecord = {
  id: string;
  conversationId: string;
  userId: string;
};

type SetConversationBlockInput = {
  conversationId: string;
  targetUserIds: string[];
  action: BlockAction;
  actorUserId: string | null;
  actorType: BlockActorType;
  source: BlockSource;
  reason?: string | null;
  batchId?: string | null;
  occurredAt?: Date;
};

type SetConversationBlockResult = {
  conversationId: string;
  action: BlockAction;
  updatedMembers: Array<{
    userId: string;
    email: string | null;
    role: string | null;
    blockedAt: Date | null;
  }>;
};

type UnblockAllResult = {
  batchId: string;
  processedCount: number;
  remainingCount: number;
};

function toEventAction(action: BlockAction): 'BLOCK' | 'UNBLOCK' {
  return action === 'block' ? 'BLOCK' : 'UNBLOCK';
}

function toBlockedAt(action: BlockAction, occurredAt: Date): Date | null {
  return action === 'block' ? occurredAt : null;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const prismaError = error as Prisma.PrismaClientKnownRequestError;
  return prismaError.code === 'P2034' ||
    error.message.includes('could not serialize access') ||
    error.message.includes('deadlock detected');
}

export class ConversationBlockEventService {
  private async applyBlockMutation(
    tx: Prisma.TransactionClient,
    input: SetConversationBlockInput,
  ): Promise<SetConversationBlockResult> {
    const targetUserIds = [...new Set(input.targetUserIds)];
    const occurredAt = input.occurredAt ?? new Date();

    const targetMembers = await tx.conversationMember.findMany({
      where: {
        conversationId: input.conversationId,
        userId: { in: targetUserIds },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (targetMembers.length !== targetUserIds.length) {
      throw new ConversationBlockEventServiceError('Member not found in conversation', 'NOT_FOUND', {
        expectedCount: targetUserIds.length,
        foundCount: targetMembers.length,
      });
    }

    const eventData = targetMembers.map((member: MemberWithUser) => ({
      conversationId: input.conversationId,
      userId: member.userId,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      action: toEventAction(input.action),
      source: input.source,
      batchId: input.batchId ?? null,
      reason: input.reason ?? null,
      createdAt: occurredAt,
    }));

    const createdEvents = await tx.conversationBlockEvent.createMany({
      data: eventData,
    });

    const updatedMembers = await tx.conversationMember.updateMany({
      where: {
        conversationId: input.conversationId,
        userId: { in: targetUserIds },
      },
      data: {
        blockedAt: toBlockedAt(input.action, occurredAt),
      },
    });

    if (createdEvents.count !== targetMembers.length || updatedMembers.count !== targetMembers.length) {
      throw new ConversationBlockEventServiceError('Block mutation conflict', 'STATE_CONFLICT', {
        expectedCount: targetMembers.length,
        createdEvents: createdEvents.count,
        updatedMembers: updatedMembers.count,
      });
    }

    const refreshedMembers = await tx.conversationMember.findMany({
      where: {
        conversationId: input.conversationId,
        userId: { in: targetUserIds },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { userId: 'asc' },
    });

    return {
      conversationId: input.conversationId,
      action: input.action,
      updatedMembers: refreshedMembers.map((member: MemberWithUser) => ({
        userId: member.userId,
        email: member.user?.email ?? null,
        role: member.user?.role ?? null,
        blockedAt: member.blockedAt,
      })),
    };
  }

  async setConversationBlock(input: SetConversationBlockInput): Promise<SetConversationBlockResult> {
    try {
      return await withTransactionRetry(
        () => prisma.$transaction(
          (tx: Prisma.TransactionClient) => this.applyBlockMutation(tx, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
        3,
        80,
      );
    } catch (error) {
      if (error instanceof ConversationBlockEventServiceError) {
        throw error;
      }

      if (isRetryableTransactionError(error)) {
        throw new ConversationBlockEventServiceError('Block mutation conflict', 'STATE_CONFLICT');
      }

      throw error;
    }
  }

  async unblockAllConversationMembers(actorUserId: string): Promise<UnblockAllResult> {
    const totalBlocked = await prisma.conversationMember.count({
      where: { blockedAt: { not: null } },
    });

    if (totalBlocked > DEFAULT_BULK_MAX_SYNC) {
      throw new ConversationBlockEventServiceError('Bulk unblock too large for sync execution', 'BULK_TOO_LARGE', {
        totalBlocked,
        maxSync: DEFAULT_BULK_MAX_SYNC,
      });
    }

    const batchId = crypto.randomUUID();
    let processedCount = 0;
    let cursorId: string | null = null;

    while (true) {
      const chunk: BlockedChunkItem[] = await prisma.conversationMember.findMany({
        where: {
          blockedAt: { not: null },
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: DEFAULT_BULK_CHUNK_SIZE,
        select: {
          id: true,
        },
      });

      if (chunk.length === 0) {
        break;
      }

      const chunkIds = chunk.map((item: BlockedChunkItem) => item.id);
      cursorId = chunk[chunk.length - 1]?.id ?? null;

      try {
        const processedThisChunk = await withTransactionRetry(
          async () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const blockedMembers: BlockedMemberRecord[] = await tx.conversationMember.findMany({
              where: {
                id: { in: chunkIds },
                blockedAt: { not: null },
              },
              select: {
                id: true,
                conversationId: true,
                userId: true,
              },
            });

            if (blockedMembers.length === 0) {
              return 0;
            }

            const createdEvents = await tx.conversationBlockEvent.createMany({
              data: blockedMembers.map((member: BlockedMemberRecord) => ({
                conversationId: member.conversationId,
                userId: member.userId,
                actorUserId,
                actorType: 'ADMIN',
                action: 'UNBLOCK',
                source: 'ADMIN_BULK',
                batchId,
              })),
            });

            const updatedMembers = await tx.conversationMember.updateMany({
              where: {
                id: { in: blockedMembers.map((member: BlockedMemberRecord) => member.id) },
                blockedAt: { not: null },
              },
              data: {
                blockedAt: null,
              },
            });

            if (createdEvents.count !== blockedMembers.length || updatedMembers.count !== blockedMembers.length) {
              throw new ConversationBlockEventServiceError('Bulk unblock conflict', 'BULK_CONFLICT_RETRYABLE', {
                expectedCount: blockedMembers.length,
                createdEvents: createdEvents.count,
                updatedMembers: updatedMembers.count,
              });
            }

            return blockedMembers.length;
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
          3,
          80,
        );

        processedCount += processedThisChunk;
      } catch (error) {
        if (error instanceof ConversationBlockEventServiceError) {
          throw error;
        }

        if (isRetryableTransactionError(error)) {
          throw new ConversationBlockEventServiceError('Bulk unblock conflict', 'BULK_CONFLICT_RETRYABLE', {
            processedCount,
            batchId,
          });
        }

        secureLogger.error('ADMIN_BULK_UNBLOCK_FAILED', {
          batchId,
          processedCount,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const remainingCount = await prisma.conversationMember.count({
      where: { blockedAt: { not: null } },
    });

    return {
      batchId,
      processedCount,
      remainingCount,
    };
  }
}

export const conversationBlockEventService = new ConversationBlockEventService();
export { ConversationBlockEventServiceError, DEFAULT_BULK_CHUNK_SIZE, DEFAULT_BULK_MAX_SYNC };
