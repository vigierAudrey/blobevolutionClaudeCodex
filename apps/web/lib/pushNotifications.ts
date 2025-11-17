/**
 * Push Notifications Management for Blobinfini
 * Handles subscription, permission requests, and notification display
 */

import {
  requestNotificationPermission,
  saveFCMToken,
  isPushSupported,
  getNotificationPermission,
  unsubscribeFromPush,
  onTokenRefresh
} from './firebase';

export interface PushSubscriptionData {
  token: string;
  userId?: string;
  deviceInfo?: {
    userAgent: string;
    platform: string;
    timestamp: number;
  };
}

export interface NotificationData {
  title: string;
  body: string;
  type: 'booking_accepted' | 'booking_rejected' | 'new_message' | 'reminder' | 'general';
  url?: string;
  icon?: string;
  data?: Record<string, unknown>;
}

/**
 * Initialize push notifications for the app
 */
export class PushNotificationManager {
  private isInitialized = false;
  private currentToken: string | null = null;
  private unsubscribeTokenRefresh: (() => void) | null = null;

  constructor() {
    this.init();
  }

  /**
   * Initialize the push notification system
   */
  private async init() {
    if (this.isInitialized) return;

    try {
      // Check if push is supported
      if (!isPushSupported()) {
        console.log('📱 Push notifications not supported on this device');
        return;
      }

      // Listen for token refresh
      this.unsubscribeTokenRefresh = onTokenRefresh((token) => {
        console.log('🔄 FCM Token refreshed');
        this.currentToken = token;
        this.saveBGToken(token);
      });

      this.isInitialized = true;
      console.log('✅ Push Notification Manager initialized');

    } catch (error) {
      console.error('❌ Failed to initialize push notifications:', error);
    }
  }

  /**
   * Request permission and subscribe to push notifications
   */
  async subscribe(userId?: string): Promise<boolean> {
    try {
      if (!isPushSupported()) {
        throw new Error('Push notifications not supported');
      }

      // Request permission and get token
      const token = await requestNotificationPermission();

      if (!token) {
        console.log('❌ Failed to get FCM token');
        return false;
      }

      this.currentToken = token;

      // Save token to backend
      const saved = await saveFCMToken(token, userId);

      if (saved) {
        // Store subscription locally
        localStorage.setItem('pushSubscribed', 'true');
        localStorage.setItem('fcmToken', token);
        if (userId) {
          localStorage.setItem('pushUserId', userId);
        }

        console.log('✅ Successfully subscribed to push notifications');
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Error subscribing to push notifications:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe(): Promise<boolean> {
    try {
      const success = await unsubscribeFromPush();

      if (success) {
        const storedToken = localStorage.getItem('fcmToken');
        // Clear local storage
        localStorage.removeItem('pushSubscribed');
        localStorage.removeItem('fcmToken');
        localStorage.removeItem('pushUserId');

        this.currentToken = null;

        // Notify backend
        await fetch('/api/push/unregister', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`
          },
          body: JSON.stringify(storedToken ? { token: storedToken } : {})
        }).catch(e => console.log('Failed to notify backend:', e));

        console.log('✅ Successfully unsubscribed from push notifications');
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Error unsubscribing from push notifications:', error);
      return false;
    }
  }

  /**
   * Check if user is currently subscribed
   */
  isSubscribed(): boolean {
    return localStorage.getItem('pushSubscribed') === 'true' && !!this.currentToken;
  }

  /**
   * Get current notification permission status
   */
  getPermissionStatus(): NotificationPermission {
    return getNotificationPermission();
  }

  /**
   * Show notification permission prompt with custom UI
   */
  async promptForPermission(customMessage?: string): Promise<boolean> {
    const permission = this.getPermissionStatus();

    if (permission === 'granted') {
      return true;
    }

    if (permission === 'denied') {
      // Show instructions to enable in browser settings
      this.showPermissionDeniedDialog();
      return false;
    }

    // Show custom prompt before browser prompt
    const userWantsNotifications = await this.showCustomPermissionDialog(customMessage);

    if (!userWantsNotifications) {
      return false;
    }

    // Request permission through Firebase
    const token = await requestNotificationPermission();
    return !!token;
  }

  /**
   * Save token in background (without UI)
   */
  private async saveBGToken(token: string) {
    const userId = localStorage.getItem('pushUserId');
    await saveFCMToken(token, userId || undefined);
  }

  /**
   * Show custom permission dialog
   */
  private async showCustomPermissionDialog(message?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
      dialog.innerHTML = `
        <div class="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
          <div class="text-center">
            <div class="text-4xl mb-4">🔔</div>
            <h3 class="text-lg font-semibold text-gray-900">
              Activer les notifications ?
            </h3>
            <p class="text-sm text-gray-600 mt-2">
              ${message || 'Reçois des notifications pour tes cours, messages et rappels importants.'}
            </p>
          </div>
          <div class="space-y-2">
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2">🏄</span>
              <span>Confirmations de cours</span>
            </div>
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2">💬</span>
              <span>Nouveaux messages</span>
            </div>
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2">⏰</span>
              <span>Rappels de cours</span>
            </div>
          </div>
          <div class="flex space-x-3">
            <button id="deny-notifications" class="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50">
              Pas maintenant
            </button>
            <button id="allow-notifications" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              Activer
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      const denyBtn = dialog.querySelector('#deny-notifications');
      const allowBtn = dialog.querySelector('#allow-notifications');

      const cleanup = () => {
        document.body.removeChild(dialog);
      };

      denyBtn?.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });

      allowBtn?.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      // Close on backdrop click
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
          cleanup();
          resolve(false);
        }
      });
    });
  }

  /**
   * Show dialog when permission is denied
   */
  private showPermissionDeniedDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
    dialog.innerHTML = `
      <div class="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
        <div class="text-center">
          <div class="text-4xl mb-4">🚫</div>
          <h3 class="text-lg font-semibold text-gray-900">
            Notifications bloquées
          </h3>
          <p class="text-sm text-gray-600 mt-2">
            Pour recevoir les notifications Blobinfini, active-les dans les paramètres de ton navigateur.
          </p>
        </div>
        <div class="text-xs text-gray-500 space-y-1">
          <p><strong>Chrome/Edge:</strong> Clique sur l'icône 🔒 à gauche de l'adresse</p>
          <p><strong>Safari:</strong> Safari > Préférences > Sites web > Notifications</p>
          <p><strong>Firefox:</strong> Paramètres > Vie privée > Notifications</p>
        </div>
        <button id="close-dialog" class="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          J'ai compris
        </button>
      </div>
    `;

    document.body.appendChild(dialog);

    const closeBtn = dialog.querySelector('#close-dialog');
    const cleanup = () => {
      document.body.removeChild(dialog);
    };

    closeBtn?.addEventListener('click', cleanup);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) cleanup();
    });
  }

  /**
   * Test notification (for development)
   */
  async testNotification(): Promise<boolean> {
    if (!this.isSubscribed()) {
      console.log('❌ Not subscribed to notifications');
      return false;
    }

    try {
      const response = await fetch('/api/push/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`
        },
        body: JSON.stringify({
          title: '🧪 Test Blobinfini',
          body: 'Si tu vois ça, les notifications fonctionnent ! 🎉',
          type: 'general'
        })
      });

      return response.ok;
    } catch (error) {
      console.error('❌ Error sending test notification:', error);
      return false;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.unsubscribeTokenRefresh) {
      this.unsubscribeTokenRefresh();
    }
  }
}

// Singleton instance
export const pushManager = new PushNotificationManager();
