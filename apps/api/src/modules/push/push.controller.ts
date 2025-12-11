/**
 * Push Notifications Controller for Blobinfini API
 * Handles subscription, unsubscription, and sending push notifications
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerifiedEmail } from '../auth/auth.guard';
import { pushNotificationService } from '../../services/push-notification.service';
import { secureLogger } from '../../utils/secure-logger';

const router = Router();
router.use(requireAuth, requireVerifiedEmail);

// Validation schemas
const subscribeSchema = z.object({
  token: z.string().min(1, 'FCM token is required'),
  userId: z.string().optional(),
  userAgent: z.string().optional(),
  timestamp: z.number().optional()
});

const unsubscribeSchema = z.object({
  token: z.string().optional()
});

const testNotificationSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  type: z.enum(['booking_accepted', 'booking_rejected', 'new_message', 'reminder', 'general']).default('general'),
  url: z.string().optional()
});

const sendNotificationSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  type: z.enum(['booking_accepted', 'booking_rejected', 'new_message', 'reminder', 'general']),
  url: z.string().optional(),
  data: z.record(z.any()).optional()
});

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
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    secureLogger.info('PUSH_ROUTE_SUBSCRIBE', { userId });

    const success = await pushNotificationService.saveToken(userId, token, userAgent);

    if (success) {
      res.status(200).json({
        success: true,
        message: 'Successfully subscribed to push notifications'
      });

      // Send welcome notification
      setTimeout(async () => {
        await pushNotificationService.sendTestNotification(userId);
      }, 2000);

    } else {
      res.status(500).json({
        error: 'Failed to save push notification token'
      });
    }
  } catch (error) {
    secureLogger.error('PUSH_ROUTE_SUBSCRIBE_FAILED', { error: (error as Error)?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/push/subscribe
 * Subscribe to push notifications
 */
router.post('/subscribe', handleSubscribe);
router.post('/register', handleSubscribe);

const handleUnsubscribe = async (req: Request, res: Response) => {
  try {
    const validation = unsubscribeSchema.safeParse(req.body ?? {});
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    secureLogger.info('PUSH_ROUTE_UNSUBSCRIBE', { userId });

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
    secureLogger.error('PUSH_ROUTE_UNSUBSCRIBE_FAILED', { error: (error as Error)?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.post('/unsubscribe', handleUnsubscribe);
router.post('/unregister', handleUnsubscribe);

/**
 * POST /api/push/test
 * Send a test notification to the current user
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const validation = testNotificationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: validation.error.errors
      });
    }

    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    secureLogger.info('PUSH_ROUTE_TEST_NOTIFICATION', { userId });

    const success = await pushNotificationService.sendToUser(userId, {
      ...validation.data,
      userId
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
    secureLogger.error('PUSH_ROUTE_TEST_FAILED', { error: (error as Error)?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/push/send
 * Send notification to a specific user (admin only)
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    // Check if user is admin
    if ((req as any).user?.role !== 'ADMIN') {
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

    secureLogger.info('PUSH_ROUTE_SEND', { userId });

    const success = await pushNotificationService.sendToUser(userId, {
      title,
      body,
      type,
      url,
      data,
      userId
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
    secureLogger.error('PUSH_ROUTE_SEND_FAILED', { error: (error as Error)?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/push/status
 * Get push notification status for current user
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    const hasActiveTokens = await pushNotificationService.hasActiveTokens(userId);

    res.status(200).json({
      userId,
      hasActiveTokens,
      isConfigured: process.env.FIREBASE_PROJECT_ID ? true : false,
      timestamp: Date.now()
    });
  } catch (error) {
    secureLogger.error('PUSH_ROUTE_STATUS_FAILED', { error: (error as Error)?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Trigger booking acceptance notification
 */
export async function notifyBookingAccepted(
  userId: string,
  bookingData: {
    proName: string;
    spotName: string;
    dateTime: string;
    conversationId?: string;
  }
): Promise<void> {
  try {
    await pushNotificationService.sendBookingAccepted(userId, bookingData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_BOOKING_ACCEPTED_FAILED', { userId, error: (error as Error)?.message });
  }
}

/**
 * Trigger booking rejection notification
 */
export async function notifyBookingRejected(
  userId: string,
  bookingData: {
    proName: string;
    spotName: string;
    reason?: string;
  }
): Promise<void> {
  try {
    await pushNotificationService.sendBookingRejected(userId, bookingData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_BOOKING_REJECTED_FAILED', { userId, error: (error as Error)?.message });
  }
}

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
  try {
    await pushNotificationService.sendNewMessage(userId, messageData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_NEW_MESSAGE_FAILED', { userId, error: (error as Error)?.message });
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
  try {
    await pushNotificationService.sendCourseReminder(userId, reminderData);
  } catch (error) {
    secureLogger.error('PUSH_NOTIFY_COURSE_REMINDER_FAILED', { userId, error: (error as Error)?.message });
  }
}

export default router;
