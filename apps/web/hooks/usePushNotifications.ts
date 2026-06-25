/**
 * React Hook for Push Notifications in Blobinfini
 *
 * Drives the per-browser push subscription UI. Invariants:
 *  - no permission prompt on mount; permission is requested only from a
 *    user-initiated subscribe() call.
 *  - no token / userId / subscription flag in localStorage.
 *  - identity is resolved server-side from the auth cookie (no userId sent).
 *  - logs are neutral (no token, no payload, no raw provider error).
 */

import { useEffect, useState, useCallback } from 'react';
import { pushManager } from '../lib/pushNotifications';

export interface UsePushNotificationsReturn {
  // State
  isSubscribed: boolean;
  isSupported: boolean;
  permission: NotificationPermission;
  isLoading: boolean;

  // Actions
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  refreshStatus: () => Promise<void>;

  // Utils
  canSubscribe: boolean;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Read the current server status for this account (no prompt, no storage).
   */
  const refreshStatus = useCallback(async (): Promise<void> => {
    const hasTokens = await pushManager.checkServerStatus();
    if (hasTokens !== null) {
      setIsSubscribed(hasTokens);
    }
  }, []);

  // On mount: detect support and current permission. NEVER prompt here.
  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator;

    setIsSupported(supported);
    setPermission(pushManager.getPermissionStatus());

    // Reflect server state only when the browser already granted permission;
    // this avoids any implicit prompt and any wasteful call otherwise.
    if (supported && pushManager.getPermissionStatus() === 'granted') {
      void refreshStatus();
    }
  }, [refreshStatus]);

  /**
   * Subscribe this browser (user-initiated): requests permission, gets the FCM
   * token and registers it server-side. No userId is sent.
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    setIsLoading(true);
    try {
      const success = await pushManager.subscribe();

      // Reflect the resulting permission state without prompting again.
      setPermission(pushManager.getPermissionStatus());

      if (success) {
        setIsSubscribed(true);
      }
      return success;
    } catch {
      // Neutral: no token, no payload, no stack.
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  /**
   * Unsubscribe this browser: removes the token server-side and tears down the
   * browser subscription.
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const success = await pushManager.unsubscribe();
      if (success) {
        setIsSubscribed(false);
      }
      return success;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const canSubscribe = isSupported && permission !== 'denied' && !isSubscribed;

  return {
    isSubscribed,
    isSupported,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
    refreshStatus,
    canSubscribe,
  };
}
