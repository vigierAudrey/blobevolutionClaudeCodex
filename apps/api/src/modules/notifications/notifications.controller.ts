import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { secureLogger } from '../../utils/secure-logger';
import { createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../../services/notification.service';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireVerifiedEmail);

// Rate limit: 60/min/user — polling-friendly, not per-request tight
const notificationsListLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60_000,
    limit: 60,
    keyGenerator: (req: Request) => `notif_list:${(req as any).user?.id ?? 'anon'}`,
  },
  'notif_list',
);

const notificationsReadLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60_000,
    limit: 120,
    keyGenerator: (req: Request) => `notif_read:${(req as any).user?.id ?? 'anon'}`,
  },
  'notif_read',
);

const MAX_LIMIT = 50;

const listQuerySchema = z.object({
  cursor: z.string().datetime({ offset: true }).optional(),
  // Over-limit values are clamped to MAX_LIMIT server-side (UX: no 400 for minor overshoots)
  limit: z.coerce.number().int().min(1).optional().default(20).transform((v) => Math.min(v, MAX_LIMIT)),
});

const notificationIdParamSchema = z.object({
  id: z.string().min(1).max(128),
});

// GET /notifications — paginated list (cursor = createdAt ISO)
notificationsRouter.get('/', notificationsListLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
  }
  const { cursor, limit } = parsed.data;

  try {
    const result = await listNotifications(userId, cursor, limit);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      items: result.items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        url: n.url,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    secureLogger.error('NOTIFICATIONS_LIST_ERROR', { userId, error: String(err) });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// GET /notifications/unread-count — badge count
notificationsRouter.get('/unread-count', notificationsListLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const count = await getUnreadCount(userId);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ count });
  } catch (err) {
    secureLogger.error('NOTIFICATIONS_UNREAD_COUNT_ERROR', { userId, error: String(err) });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// PATCH /notifications/:id/read — mark single notification as read (idempotent)
notificationsRouter.patch('/:id/read', notificationsReadLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const parsed = notificationIdParamSchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid notification id' });

  try {
    await markNotificationRead(userId, parsed.data.id);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ ok: true });
  } catch (err) {
    secureLogger.error('NOTIFICATIONS_MARK_READ_ERROR', { userId, error: String(err) });
    return res.status(500).json({ error: 'Internal error' });
  }
});

// POST /notifications/read-all — mark all as read
notificationsRouter.post('/read-all', notificationsReadLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    await markAllNotificationsRead(userId);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ ok: true });
  } catch (err) {
    secureLogger.error('NOTIFICATIONS_READ_ALL_ERROR', { userId, error: String(err) });
    return res.status(500).json({ error: 'Internal error' });
  }
});
