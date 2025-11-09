/**
 * Mock du Push Notification Service pour les tests
 * Ce mock évite les warnings PUSH_SERVICE_NOT_INITIALIZED
 * et simule un service correctement initialisé
 */

import type { PushNotificationData } from '../push-notification.service';

export class PushNotificationService {
  private isInitialized = true; // Toujours initialisé en test

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
