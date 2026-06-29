/**
 * Mock du Push Notification Service pour les tests
 * Ce mock évite les warnings PUSH_SERVICE_NOT_INITIALIZED
 * et simule un service correctement initialisé
 */

import type { PushNotificationData } from '../push-notification.service';

export class PushNotificationService {
  private isInitialized = true; // Toujours initialisé en test

  isConfigured(): boolean {
    return (
      process.env.PUSH_NOTIFICATIONS_ENABLED === 'true' &&
      Boolean(process.env.FIREBASE_PROJECT_ID) &&
      Boolean(process.env.FIREBASE_CLIENT_EMAIL) &&
      Boolean(process.env.FIREBASE_PRIVATE_KEY) &&
      process.env.FIREBASE_PROJECT_ID !== 'blobinfini-demo'
    );
  }

  async saveToken(userId: string, token: string, userAgent?: string): Promise<boolean> {
    return true;
  }

  async removeToken(userId: string, token?: string): Promise<boolean> {
    return true;
  }

  async hasActiveTokens(userId: string): Promise<boolean> {
    return false;
  }

  async sendToUser(userId: string, notification: PushNotificationData): Promise<boolean> {
    // Mock: retourne toujours true (notification envoyée avec succès)
    return true;
  }

  async sendBookingAccepted(riderUserId: string, proName: string, spotName: string): Promise<boolean> {
    return true;
  }

  async sendBookingRejected(riderUserId: string, proName: string, reason?: string): Promise<boolean> {
    return true;
  }

  async sendNewMessage(recipientUserId: string, senderName: string, preview: string): Promise<boolean> {
    return true;
  }

  async subscribeTopic(token: string, topic: string): Promise<boolean> {
    return true;
  }

  async unsubscribeTopic(token: string, topic: string): Promise<boolean> {
    return true;
  }
}

// Singleton mocké
export const pushNotificationService = new PushNotificationService();
