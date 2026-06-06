import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';

// Keep in sync with NotificationType enum in packages/database/prisma/schema.prisma
export const NotificationType = {
  NEW_MESSAGE: 'NEW_MESSAGE',
  NEW_MATCH: 'NEW_MATCH',
  GROUP_INVITATION: 'GROUP_INVITATION',
  SYSTEM: 'SYSTEM',
  LESSON_REQUEST_NEARBY: 'LESSON_REQUEST_NEARBY',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string | null;
  data: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
}

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  url: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

const MAX_PER_PAGE = 20;
const MAX_LIMIT = 50;

function safeErrorMeta(error: unknown): { errorName?: string; errorCode?: string } {
  const record = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : null;
  return {
    ...(typeof record?.name === 'string' ? { errorName: record.name } : {}),
    ...(typeof record?.code === 'string' ? { errorCode: record.code } : {}),
  };
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationRow> {
  return prisma.notification.create({
    data: input,
    select: NOTIFICATION_SELECT,
  });
}

export async function listNotifications(
  userId: string,
  cursor?: string,
  limit = MAX_PER_PAGE,
): Promise<{ items: NotificationRow[]; nextCursor: string | null }> {
  const take = Math.min(limit, MAX_LIMIT);

  const where: Parameters<typeof prisma.notification.findMany>[0]['where'] = { userId };
  if (cursor) {
    where.createdAt = { lt: new Date(cursor) };
  }

  const rows = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    select: NOTIFICATION_SELECT,
  });

  const hasMore = rows.length > take;
  if (hasMore) rows.pop();

  return {
    items: rows,
    nextCursor: hasMore ? rows[rows.length - 1].createdAt.toISOString() : null,
  };
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  // Idempotent + IDOR-safe: where clause enforces ownership
  await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

// Non-blocking wrapper: logs errors without throwing
export function createNotificationSilent(input: CreateNotificationInput): void {
  void createNotification(input).catch((err: unknown) => {
    secureLogger.warn('NOTIFICATION_CREATE_FAILED', {
      type: input.type,
      ...safeErrorMeta(err),
    });
  });
}
