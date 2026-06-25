/**
 * Push Notifications Management for Blobinfini
 *
 * Wires the browser-level FCM subscription to the backend. Key invariants:
 *  - the front never sends a userId; identity is resolved server-side from the
 *    auth cookie (anti-IDOR).
 *  - no token / userId / subscription flag is ever stored in localStorage.
 *  - no permission prompt is triggered on load; permission is only requested
 *    from a user-initiated subscribe() call.
 *  - logs are neutral: no token, no token prefix, no foreground payload, no raw
 *    provider error.
 */

import {
  requestNotificationPermission,
  saveFCMToken,
  isPushSupported,
  getNotificationPermission,
  unregisterFCMToken,
  fetchPushStatus,
  onTokenRefresh,
} from './firebase';

export interface NotificationData {
  title: string;
  body: string;
  type: 'new_message' | 'reminder' | 'general';
  url?: string;
  icon?: string;
  data?: Record<string, unknown>;
}

/**
 * Manages the push notification subscription for the current browser.
 */
export class PushNotificationManager {
  private isInitialized = false;
  private currentToken: string | null = null;
  private unsubscribeTokenRefresh: (() => void) | null = null;

  constructor() {
    this.init();
  }

  /**
   * Initialize the push notification system.
   * Sets up the foreground/token-refresh listener only. It NEVER requests
   * notification permission and NEVER auto-subscribes.
   */
  private init() {
    if (this.isInitialized) return;

    try {
      if (!isPushSupported()) {
        return;
      }

      // Listen for token refresh. When the token rotates while already
      // subscribed, re-register it server-side (no userId, cookie auth).
      this.unsubscribeTokenRefresh = onTokenRefresh((token) => {
        this.currentToken = token;
        void saveFCMToken(token);
      });

      this.isInitialized = true;
    } catch {
      // Neutral: push stays off, nothing is surfaced.
    }
  }

  /**
   * Request permission (user-initiated) and subscribe this browser.
   * No userId is passed; identity comes from the auth cookie server-side.
   */
  async subscribe(): Promise<boolean> {
    if (!isPushSupported()) {
      return false;
    }

    // Request permission and get token (only reached on a user action).
    const token = await requestNotificationPermission();
    if (!token) {
      return false;
    }

    this.currentToken = token;

    const saved = await saveFCMToken(token);
    if (!saved) {
      this.currentToken = null;
    }
    return saved;
  }

  /**
   * Unsubscribe THIS browser: remove only this device's token server-side and
   * tear down the browser subscription. No localStorage is touched.
   *
   * We only act when we hold this browser's token (set by a subscribe() done in
   * this session). Without it we cannot scope the removal to this device, so we
   * refuse rather than wipe push from every device of the account.
   */
  async unsubscribe(): Promise<boolean> {
    if (!this.currentToken) {
      return false;
    }
    const success = await unregisterFCMToken(this.currentToken);
    if (success) {
      this.currentToken = null;
    }
    return success;
  }

  /**
   * Whether this browser holds a token registered during this session — the only
   * reliable local proof that *this* device is subscribed (server status is
   * account-level and cannot confirm a specific browser).
   */
  hasLocalToken(): boolean {
    return this.currentToken !== null;
  }

  /**
   * Ask the server whether this account currently has active push tokens.
   * Returns null when the status is unknown (feature off / network error).
   * Does not prompt and does not store anything.
   */
  async checkServerStatus(): Promise<boolean | null> {
    const status = await fetchPushStatus();
    return status ? status.hasActiveTokens : null;
  }

  /**
   * Get current notification permission status (no prompt).
   */
  getPermissionStatus(): NotificationPermission {
    return getNotificationPermission();
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
