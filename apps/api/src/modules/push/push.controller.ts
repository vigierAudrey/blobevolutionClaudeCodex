/**
 * Push Notifications Controller for Blobinfini API
 * Handles subscription, unsubscription, and sending push notifications
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { pushNotificationService } from '../../services/push-notification.service';
import { secureLogger } from '../../utils/secure-logger';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';

const router = Router();

function isPushFeatureEnabled(): boolean {
  return process.env.PUSH_NOTIFICATIONS_ENABLED === 'true';
}

function requirePushFeatureEnabled(_req: Request, res: Response, next: () => void) {
  if (!isPushFeatureEnabled()) {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

async function ensurePushUserEligible(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true, deletedAt: true },
  });
  return Boolean(user?.emailVerified && !user.deletedAt);
}

router.use(requireAuth, requireVerifiedEmail, requirePushFeatureEnabled);

type AuthenticatedRequest = Request & { user?: { id?: string; role?: string } };

const pushTokenLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 10 * 60_000,
    limit: 12,
    keyGenerator: (req: Request) => `push_token:${(req as AuthenticatedRequest).user?.id ?? 'anon'}`,
  },
  'push_token',
);

const pushSendLimiter = createLazyCustomRateLimiter(
  {
    windowMs: 60_000,
    limit: 5,
    keyGenerator: (req: Request) => `push_send:${(req as AuthenticatedRequest).user?.id ?? 'anon'}`,
  },
  'push_send',
);

function safeErrorMeta(error: unknown): { errorName?: string; errorCode?: string } {
  const record = error && typeof error === 'object'
    ? error as { name?: unknown; code?: unknown }
    : null;
  return {
    ...(typeof record?.name === 'string' ? { errorName: record.name } : {}),
    ...(typeof record?.code === 'string' ? { errorCode: record.code } : {}),
  };
}

// Validation schemas
const subscribeSchema = z.object({
  token: z.string().min(1, 'FCM token is required').max(4096, 'FCM token is too large'),
  userAgent: z.string().max(512, 'User agent is too large').optional(),
  timestamp: z.number().int().nonnegative().optional()
}).strict();

const unsubscribeSchema = z.object({
  token: z.string().min(1).max(4096).optional()
}).strict();

const testNotificationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120, 'Title is too large'),
  body: z.string().min(1, 'Body is required').max(500, 'Body is too large'),
  type: z.enum(['new_message', 'reminder', 'general']).default('general'),
  url: z.string().max(2048, 'URL is too large').optional()
}).strict();

const sendNotificationSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  title: z.string().min(1, 'Title is required').max(120, 'Title is too large'),
  body: z.string().min(1, 'Body is required').max(500, 'Body is too large'),
  type: z.enum(['new_message', 'reminder', 'general']),
  url: z.string().max(2048, 'URL is too large').optional(),
  data: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional()
}).strict();

const handleSubscribe = async (req: Request, res: Response) => {
  try {
    const validation = subscribeSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const { token, userAgent } = validation.data;
    const userId = (req as AuthenticatedRequest).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    if (!(await ensurePushUserEligible(userId))) {
      return res.status(403).json({ error: 'Account unavailable' });
    }

    secureLogger.info('PUSH_ROUTE_SUBSCRIBE', { authenticated: true });

    const success = await pushNotificationService.saveToken(userId, token, userAgent);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Successfully subscribed to push notifications'
      });

    } else {
      res.status(500).json({
        error: 'Failed to save push notification token'
      });
    }
  } catch (error) {
    secureLogger.error('PUSH_ROUTE_SUBSCRIBE_FAILED', safeErrorMeta(error));
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/push/subscribe
 * Subscribe to push notifications
 */
router.post('/subscribe', pushTokenLimiter, handleSubscribe);
router.post('/register', pushTokenLimiter, handleSubscribe);

const handleUnsubscribe = async (req: Request, res: Response) => {
  try {
    const validation = unsubscribeSchema.safeParse(req.body ?? {});
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const userId = (req as AuthenticatedRequest).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    if (!(await ensurePushUserEligible(userId))) {
      return res.status(403).json({ error: 'Account unavailable' });
    }

    secureLogger.info('PUSH_ROUTE_UNSUBSCRIBE', { authenticated: true });

    const success = await pushNotificationService.removeToken(userId, validation.data.token);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Successfully unsubscribed from push notifications'
      });
    } else {
      res.status(500).json({
        error: 'Failed to remove push notification tokens'
      });
    }
  } catch (error) {
    secureLogger.error('PUSH_ROUTE_UNSUBSCRIBE_FAILED', safeErrorMeta(error));
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.post('/unsubscribe', pushTokenLimiter, handleUnsubscribe);
router.post('/unregister', pushTokenLimiter, handleUnsubscribe);

/**
 * POST /api/push/test
 * Send a test notification to the current user
 */
router.post('/test', pushSendLimiter, async (req: Request, res: Response) => {
  try {
    if ((req as AuthenticatedRequest).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const validation = testNotificationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const userId = (req as AuthenticatedRequest).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    if (!(await ensurePushUserEligible(userId))) {
      return res.status(403).json({ error: 'Account unavailable' });
    }

    secureLogger.info('PUSH_ROUTE_TEST_NOTIFICATION', { authenticated: true });

    const success = await pushNotificationService.sendToUser(userId, {
      ...validation.data,
    });

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Test notification sent successfully'
      });
    } else {
      res.status(500).json({
        error: 'Failed to send test notification'
      });
    }
  } catch (error) {
    secureLogger.error('PUSH_ROUTE_TEST_FAILED', safeErrorMeta(error));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/push/send
 * Send notification to a specific user (admin only)
 */
router.post('/send', pushSendLimiter, async (req: Request, res: Response) => {
  try {
    // Check if user is admin
    if ((req as AuthenticatedRequest).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const validation = sendNotificationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const { userId, title, body, type, url, data } = validation.data;

    if (!(await ensurePushUserEligible(userId))) {
      return res.status(404).json({ error: 'User not available' });
    }

    secureLogger.info('PUSH_ROUTE_SEND', { targetValidated: true });

    const success = await pushNotificationService.sendToUser(userId, {
      title,
      body,
      type,
      url,
      data,
    });

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Notification sent successfully'
      });
    } else {
      res.status(500).json({
        error: 'Failed to send notification'
      });
    }
  } catch (error) {
    secureLogger.error('PUSH_ROUTE_SEND_FAILED', safeErrorMeta(error));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/push/status
 * Get push notification status for current user
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    if (!(await ensurePushUserEligible(userId))) {
      return res.status(403).json({ error: 'Account unavailable' });
    }

    const hasActiveTokens = await pushNotificationService.hasActiveTokens(userId);

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({
      hasActiveTokens,
      isConfigured: process.env.FIREBASE_PROJECT_ID ? true : false,
      timestamp: Date.now()
    });
  } catch (error) {
    secureLogger.error('PUSH_ROUTE_STATUS_FAILED', safeErrorMeta(error));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Trigger new message notification
 */
export async function notifyNewMessage(
  userId: string,
  messageData: {
    senderName: string;
    message: string;
    conversationId: string;
  }
): Promise<void> {
  if (!isPushFeatureEnabled()) return;
  try {
    await pushNotificationService.sendNewMessage(userId, messageData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_NEW_MESSAGE_FAILED', safeErrorMeta(error));
  }
}

/**
 * Trigger course reminder notification
 */
export async function notifyCourseReminder(
  userId: string,
  reminderData: {
    proName: string;
    spotName: string;
    startTime: string;
    hoursUntil: number;
  }
): Promise<void> {
  if (!isPushFeatureEnabled()) return;
  try {
    await pushNotificationService.sendCourseReminder(userId, reminderData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_COURSE_REMINDER_FAILED', safeErrorMeta(error));
  }
}

/**
 * Trigger new match notification (Rider matched with another rider)
 */
export async function notifyNewMatchPush(
  userId: string,
  matchData: {
    matchedUserName: string;
    matchedUserPhoto?: string;
    conversationId: string;
  }
): Promise<void> {
  if (!isPushFeatureEnabled()) return;
  try {
    await pushNotificationService.sendNewMatch(userId, matchData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_NEW_MATCH_FAILED', safeErrorMeta(error));
  }
}

/**
 * Trigger group invitation notification
 */
export async function notifyGroupInvitation(
  userId: string,
  invitationData: {
    inviterName: string;
    conversationId: string;
    invitationId: string;
    memberCount: number;
  }
): Promise<void> {
  if (!isPushFeatureEnabled()) return;
  try {
    await pushNotificationService.sendGroupInvitation(userId, invitationData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_GROUP_INVITATION_FAILED', safeErrorMeta(error));
  }
}

export default router;
