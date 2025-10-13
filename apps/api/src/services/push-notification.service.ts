/**
 * Push Notification Service for Blobinfini Backend
 * Handles FCM token management and sending push notifications
 */

import admin from 'firebase-admin';

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
  type: 'booking_accepted' | 'booking_rejected' | 'new_message' | 'reminder' | 'general';
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
        console.log('✅ Push Notification Service initialized');
      } else {
        console.log('⚠️ Firebase credentials not configured, push notifications disabled');
      }
    } catch (error: any) {
      console.error('❌ Failed to initialize Push Notification Service:', error);
    }
  }

  /**
   * Save FCM token for a user
   */
  async saveToken(userId: string, token: string, userAgent?: string): Promise<boolean> {
    try {
      // Here you would save to your database
      // For now, we'll use a simple in-memory store or cache
      console.log(`💾 Saving FCM token for user ${userId}`);

      // TODO: Implement database storage
      // await prisma.pushToken.upsert({
      //   where: { userId_token: { userId, token } },
      //   update: { isActive: true, lastUsed: new Date() },
      //   create: {
      //     userId,
      //     token,
      //     userAgent,
      //     platform: this.getPlatformFromUserAgent(userAgent),
      //     isActive: true
      //   }
      // });

      return true;
    } catch (error: any) {
      console.error('❌ Error saving FCM token:', error);
      return false;
    }
  }

  /**
   * Remove FCM token for a user
   */
  async removeToken(userId: string, token?: string): Promise<boolean> {
    try {
      console.log(`🗑️ Removing FCM token for user ${userId}`);

      // TODO: Implement database removal
      // if (token) {
      //   await prisma.pushToken.delete({
      //     where: { userId_token: { userId, token } }
      //   });
      // } else {
      //   await prisma.pushToken.deleteMany({
      //     where: { userId }
      //   });
      // }

      return true;
    } catch (error: any) {
      console.error('❌ Error removing FCM token:', error);
      return false;
    }
  }

  /**
   * Send push notification to a specific user
   */
  async sendToUser(userId: string, notification: PushNotificationData): Promise<boolean> {
    if (!this.isInitialized) {
      console.log('⚠️ Push notifications not initialized');
      return false;
    }

    try {
      // Get user's FCM tokens from database
      const tokens = await this.getUserTokens(userId);

      if (tokens.length === 0) {
        console.log(`📱 No FCM tokens found for user ${userId}`);
        return false;
      }

      const results = await Promise.allSettled(
        tokens.map(token => this.sendToToken(token, notification))
      );

      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;

      console.log(`📬 Sent notification to ${successCount}/${tokens.length} devices for user ${userId}`);

      return successCount > 0;
    } catch (error: any) {
      console.error('❌ Error sending notification to user:', error);
      return false;
    }
  }

  /**
   * Send push notification to a specific token
   */
  async sendToToken(token: string, notification: PushNotificationData): Promise<boolean> {
    if (!this.isInitialized) {
      console.log('⚠️ Push notifications not initialized');
      return false;
    }

    try {
      const message = this.buildFCMMessage(token, notification);

      const response = await admin.messaging().send(message);
      console.log(`✅ Notification sent successfully: ${response}`);

      return true;
    } catch (error: any) {
      if (error.code === 'messaging/registration-token-not-registered') {
        console.log('🗑️ Token no longer valid, scheduling removal');
        // TODO: Remove invalid token from database
      } else {
        console.error('❌ Error sending notification:', error);
      }
      return false;
    }
  }

  /**
   * Send booking acceptance notification
   */
  async sendBookingAccepted(userId: string, bookingData: {
    proName: string;
    spotName: string;
    dateTime: string;
    conversationId?: string;
  }): Promise<boolean> {
    const notification: PushNotificationData = {
      title: '🎉 Demande acceptée !',
      body: `${bookingData.proName} a accepté ton cours à ${bookingData.spotName}`,
      type: 'booking_accepted',
      url: `/reservations/confirmed`,
      userId,
      data: {
        bookingId: bookingData,
        conversationId: bookingData.conversationId,
        viewUrl: '/reservations/confirmed',
        messageUrl: bookingData.conversationId ? `/messages/${bookingData.conversationId}` : undefined
      }
    };

    return this.sendToUser(userId, notification);
  }

  /**
   * Send booking rejection notification
   */
  async sendBookingRejected(userId: string, bookingData: {
    proName: string;
    spotName: string;
    reason?: string;
  }): Promise<boolean> {
    const notification: PushNotificationData = {
      title: '😔 Demande refusée',
      body: `${bookingData.proName} ne peut pas donner le cours à ${bookingData.spotName}`,
      type: 'booking_rejected',
      url: `/reservations/start`,
      userId,
      data: {
        bookingData,
        reason: bookingData.reason,
        searchUrl: '/reservations/start'
      }
    };

    return this.sendToUser(userId, notification);
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
      title: '🧪 Test Blobinfini',
      body: 'Si tu vois ça, les notifications fonctionnent parfaitement ! 🎉',
      type: 'general',
      url: '/dashboard',
      userId
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
          requireInteraction: notification.type === 'booking_accepted' || notification.type === 'booking_rejected',
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
      case 'booking_accepted':
      case 'booking_rejected':
        return 'high';
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
      case 'booking_accepted':
        return [200, 100, 200, 100, 200]; // Happy pattern
      case 'booking_rejected':
        return [100, 50, 100]; // Short pattern
      case 'new_message':
        return [150]; // Simple buzz
      case 'reminder':
        return [300, 100, 300]; // Attention pattern
      default:
        return [200];
    }
  }

  /**
   * Get action buttons for notification type
   */
  private getActionsForType(type: string, data?: Record<string, any>): Array<{ action: string; title: string }> {
    switch (type) {
      case 'booking_accepted':
        return [
          { action: 'view', title: '👀 Voir les détails' },
          { action: 'message', title: '💬 Envoyer un message' }
        ];
      case 'booking_rejected':
        return [
          { action: 'search', title: '🔍 Chercher d\'autres cours' }
        ];
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
    // TODO: Implement database query
    // const tokens = await prisma.pushToken.findMany({
    //   where: { userId, isActive: true },
    //   select: { token: true }
    // });
    // return tokens.map(t => t.token);

    // Mock implementation for development
    console.log(`🔍 Looking up tokens for user ${userId}`);
    return []; // Return empty array until database is implemented
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
