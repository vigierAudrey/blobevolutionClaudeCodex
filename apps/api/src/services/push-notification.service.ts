/**
 * Push Notification Service for Blobinfini Backend
 * Handles FCM token management and sending push notifications
 */

import admin from 'firebase-admin';
import { clientPrisma as prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';

// Firebase Admin configuration
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || 'blobinfini-demo',
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

// Initialize Firebase Admin (only once)
if (!admin.apps.length && firebaseConfig.privateKey && firebaseConfig.clientEmail) {
  admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig),
    projectId: firebaseConfig.projectId,
  });
}

export interface PushNotificationData {
  title: string;
  body: string;
  type: 'new_message' | 'reminder' | 'general';
  url?: string;
  icon?: string;
  userId?: string;
  data?: Record<string, any>;
  sound?: string;
  badge?: number;
}

export interface FCMTokenData {
  userId: string;
  token: string;
  userAgent?: string;
  platform?: string;
  createdAt: Date;
  isActive: boolean;
}

export class PushNotificationService {
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      if (firebaseConfig.privateKey && firebaseConfig.clientEmail) {
        this.isInitialized = true;
        secureLogger.info('PUSH_SERVICE_INITIALIZED', { projectId: firebaseConfig.projectId });
      } else {
        secureLogger.warn('PUSH_SERVICE_DISABLED', { reason: 'missing_credentials' });
      }
      await this.cleanupInvalidTokens();
    } catch (error: any) {
      secureLogger.error('PUSH_SERVICE_INIT_FAILED', { error: error?.message });
    }
  }

  /**
   * Save FCM token for a user
   */
  async saveToken(userId: string, token: string, userAgent?: string): Promise<boolean> {
    try {
      secureLogger.info('PUSH_TOKEN_SAVE', { userId });

      await prisma.pushToken.upsert({
        where: { token },
        create: {
          token,
          userId,
        },
        update: {
          userId,
          updatedAt: new Date(),
        },
      });

      return true;
    } catch (error: any) {
      secureLogger.error('PUSH_TOKEN_SAVE_FAILED', { userId, error: error?.message });
      return false;
    }
  }

  /**
   * Remove FCM token for a user
   */
  async removeToken(userId: string, token?: string): Promise<boolean> {
    try {
      secureLogger.info('PUSH_TOKEN_REMOVE', { userId, hasToken: Boolean(token) });
      if (token) {
        await prisma.pushToken.deleteMany({ where: { token, userId } });
      } else {
        await prisma.pushToken.deleteMany({ where: { userId } });
      }

      return true;
    } catch (error: any) {
      secureLogger.error('PUSH_TOKEN_REMOVE_FAILED', { userId, error: error?.message });
      return false;
    }
  }

  /**
   * Send push notification to a specific user
   */
  async sendToUser(userId: string, notification: PushNotificationData): Promise<boolean> {
    if (!this.isInitialized) {
      secureLogger.warn('PUSH_SERVICE_NOT_INITIALIZED', { userId });
      return false;
    }

    try {
      // Enforce NotificationPreferences — respect opt-out before any FCM call
      const prefs = await prisma.notificationPreferences.findUnique({
        where: { userId },
        select: { pushEnabled: true },
      });
      if (prefs && !prefs.pushEnabled) {
        secureLogger.info('PUSH_SKIPPED_BY_PREFERENCE', { userId });
        return false;
      }

      // Get user's FCM tokens from database
      const tokens = await this.getUserTokens(userId);

      if (tokens.length === 0) {
        secureLogger.warn('PUSH_NO_TOKENS', { userId });
        return false;
      }

      const results = await Promise.allSettled(
        tokens.map(token => this.sendToToken(token, notification))
      );

      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;

      secureLogger.info('PUSH_NOTIFICATION_SENT', { userId, successCount, total: tokens.length });

      return successCount > 0;
    } catch (error: any) {
      secureLogger.error('PUSH_USER_SEND_FAILED', { userId, error: error?.message });
      return false;
    }
  }

  /**
   * Send push notification to a specific token
   */
  async sendToToken(token: string, notification: PushNotificationData): Promise<boolean> {
    if (!this.isInitialized) {
      secureLogger.warn('PUSH_SERVICE_NOT_INITIALIZED', { reason: 'send_to_token' });
      return false;
    }

    try {
      const message = this.buildFCMMessage(token, notification);

      const response = await admin.messaging().send(message);
      secureLogger.info('PUSH_TOKEN_SENT', { responseId: response });

      return true;
    } catch (error: any) {
      if (error.code === 'messaging/registration-token-not-registered') {
        secureLogger.warn('PUSH_TOKEN_INVALID', { errorCode: error.code });
        await this.cleanupInvalidTokens(token);
      } else {
        secureLogger.error('PUSH_TOKEN_SEND_FAILED', { error: error?.message });
      }
      return false;
    }
  }

  /**
   * Send new message notification
   */
  async sendNewMessage(userId: string, messageData: {
    senderName: string;
    message: string;
    conversationId: string;
  }): Promise<boolean> {
    const notification: PushNotificationData = {
      title: `💬 ${messageData.senderName}`,
      body: messageData.message.length > 50
        ? messageData.message.substring(0, 50) + '...'
        : messageData.message,
      type: 'new_message',
      url: `/messages/${messageData.conversationId}`,
      userId,
      data: {
        conversationId: messageData.conversationId,
        senderId: messageData.senderName,
        messageUrl: `/messages/${messageData.conversationId}`
      }
    };

    return this.sendToUser(userId, notification);
  }

  /**
   * Send course reminder notification
   */
  async sendCourseReminder(userId: string, reminderData: {
    proName: string;
    spotName: string;
    startTime: string;
    hoursUntil: number;
  }): Promise<boolean> {
    const notification: PushNotificationData = {
      title: `⏰ Cours dans ${reminderData.hoursUntil}h !`,
      body: `Rendez-vous avec ${reminderData.proName} à ${reminderData.spotName}`,
      type: 'reminder',
      url: `/courses/today`,
      userId,
      data: {
        reminderData,
        hoursUntil: reminderData.hoursUntil
      }
    };

    return this.sendToUser(userId, notification);
  }

  /**
   * Send test notification
   */
  async sendTestNotification(userId: string): Promise<boolean> {
    const notification: PushNotificationData = {
      title: '🧪 Test Blob',
      body: 'Si tu vois ça, les notifications fonctionnent parfaitement ! 🎉',
      type: 'general',
      url: '/dashboard',
      userId
    };

    return this.sendToUser(userId, notification);
  }

  /**
   * Send new match notification to rider
   */
  async sendNewMatch(userId: string, matchData: {
    matchedUserName: string;
    matchedUserPhoto?: string;
    conversationId: string;
  }): Promise<boolean> {
    const notification: PushNotificationData = {
      title: '🎉 Nouveau match !',
      body: `Tu as matché avec ${matchData.matchedUserName} ! Envoie un message pour démarrer la conversation.`,
      type: 'new_message', // Réutilise le type message pour l'instant
      url: `/messages/${matchData.conversationId}`,
      userId,
      data: {
        conversationId: matchData.conversationId,
        matchedUserName: matchData.matchedUserName,
        matchedUserPhoto: matchData.matchedUserPhoto,
        messageUrl: `/messages/${matchData.conversationId}`
      }
    };

    return this.sendToUser(userId, notification);
  }

  /**
   * Send group invitation notification
   */
  async sendGroupInvitation(userId: string, invitationData: {
    inviterName: string;
    conversationId: string;
    invitationId: string;
    memberCount: number;
  }): Promise<boolean> {
    const notification: PushNotificationData = {
      title: '👥 Invitation à un groupe',
      body: `${invitationData.inviterName} t'invite à rejoindre une conversation de groupe (${invitationData.memberCount} membres)`,
      type: 'new_message', // Réutilise le type message pour l'instant
      url: `/messages/invitations`,
      userId,
      data: {
        invitationId: invitationData.invitationId,
        conversationId: invitationData.conversationId,
        inviterName: invitationData.inviterName,
        memberCount: invitationData.memberCount,
        invitationsUrl: '/messages/invitations'
      }
    };

    return this.sendToUser(userId, notification);
  }

  /**
   * Build FCM message object
   */
  private buildFCMMessage(token: string, notification: PushNotificationData): admin.messaging.Message {
    const message: admin.messaging.Message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.icon
      },
      data: {
        type: notification.type,
        url: notification.url || '/dashboard',
        userId: notification.userId || '',
        ...(notification.data || {})
      },
      webpush: {
        headers: {
          Urgency: this.getUrgencyForType(notification.type)
        },
        notification: {
          title: notification.title,
          body: notification.body,
          icon: notification.icon || '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          tag: `blobinfini-${notification.type}`,
          requireInteraction: false,
          silent: false,
          vibrate: this.getVibrationPattern(notification.type),
          actions: this.getActionsForType(notification.type, notification.data),
          data: {
            type: notification.type,
            url: notification.url || '/dashboard',
            userId: notification.userId || '',
            ...(notification.data || {})
          }
        },
        fcmOptions: {
          link: notification.url || '/dashboard'
        }
      }
    };

    return message;
  }

  /**
   * Get urgency level for notification type
   */
  private getUrgencyForType(type: string): string {
    switch (type) {
      case 'new_message':
      case 'reminder':
        return 'normal';
      default:
        return 'low';
    }
  }

  /**
   * Get vibration pattern for notification type
   */
  private getVibrationPattern(type: string): number[] {
    switch (type) {
      case 'new_message':
        return [150];
      case 'reminder':
        return [300, 100, 300];
      default:
        return [200];
    }
  }

  /**
   * Get action buttons for notification type
   */
  private getActionsForType(type: string, data?: Record<string, any>): Array<{ action: string; title: string }> {
    switch (type) {
      case 'new_message':
        return [
          { action: 'reply', title: '↩️ Répondre' },
          { action: 'view', title: '👀 Voir la conversation' }
        ];
      default:
        return [];
    }
  }

  /**
   * Get user's FCM tokens (mock implementation)
   */
  private async getUserTokens(userId: string): Promise<string[]> {
    const tokens: Array<{ token: string }> = await prisma.pushToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) {
      secureLogger.debug('PUSH_LOOKUP_TOKENS_EMPTY', { userId });
    }
    return tokens.map((t) => t.token);
  }

  async hasActiveTokens(userId: string): Promise<boolean> {
    try {
      const count = await prisma.pushToken.count({ where: { userId } });
      return count > 0;
    } catch (error: any) {
      secureLogger.error('PUSH_TOKEN_STATUS_FAILED', { userId, error: error?.message });
      return false;
    }
  }

  private async cleanupInvalidTokens(token?: string): Promise<void> {
    try {
      if (token) {
        await prisma.pushToken.deleteMany({ where: { token } });
        return;
      }

      await prisma.pushToken.deleteMany({
        where: {
          user: {
            deletedAt: { not: null },
          },
        },
      });
    } catch (error: any) {
      secureLogger.warn('PUSH_TOKEN_CLEANUP_FAILED', { error: error?.message });
    }
  }

  /**
   * Extract platform from user agent
   */
  private getPlatformFromUserAgent(userAgent?: string): string {
    if (!userAgent) return 'unknown';

    if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'ios';
    if (userAgent.includes('Android')) return 'android';
    if (userAgent.includes('Windows')) return 'windows';
    if (userAgent.includes('Mac')) return 'macos';
    return 'web';
  }
}

// Singleton instance
export const pushNotificationService = new PushNotificationService();
