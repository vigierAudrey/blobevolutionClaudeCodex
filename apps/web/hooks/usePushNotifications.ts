/**
 * React Hook for Push Notifications in Blobinfini
 *
 * Drives the per-browser push subscription UI. Invariants:
 *  - no permission prompt on mount; permission is requested only from a
 *    user-initiated subscribe() call.
 *  - no token / userId / subscription flag in localStorage.
 *  - identity is resolved server-side from the auth cookie (no userId sent).
 *  - logs are neutral (no token, no payload, no raw provider error).
 *
 * Honesty about state:
 *  - `accountHasPush` comes from GET /push/status, which is ACCOUNT-level
 *    (`hasActiveTokens`). It can be true because of another device/browser, so
 *    it must never be presented as "this browser is subscribed".
 *  - `thisBrowserActive` is the only reliable local proof that *this* browser is
 *    subscribed: it is set solely by a successful subscribe() in this session.
 */

import { useEffect, useState, useCallback } from 'react';
import { pushManager } from '../lib/pushNotifications';

export interface UsePushNotificationsReturn {
  // State
  isSupported: boolean;
  permission: NotificationPermission;
  /** Account-level push status (any device). `null` when unknown / feature off. */
  accountHasPush: boolean | null;
  /** Reliable local proof that THIS browser is subscribed (this session). */
  thisBrowserActive: boolean;
  isLoading: boolean;

  // Actions
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  refreshStatus: () => Promise<void>;

  // Utils
  canSubscribe: boolean;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [accountHasPush, setAccountHasPush] = useState<boolean | null>(null);
  const [thisBrowserActive, setThisBrowserActive] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Read the account-level server status (no prompt, no storage). Does NOT touch
   * thisBrowserActive: account status cannot confirm a specific browser.
   */
  const refreshStatus = useCallback(async (): Promise<void> => {
    const hasTokens = await pushManager.checkServerStatus();
    setAccountHasPush(hasTokens);
  }, []);

  // On mount: detect support and current permission. NEVER prompt here.
  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator;

    setIsSupported(supported);
    setPermission(pushManager.getPermissionStatus());
    setThisBrowserActive(pushManager.hasLocalToken());

    // Reflect account-level status (single call, no prompt). Skipped when the
    // browser cannot do push at all.
    if (supported) {
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
        setThisBrowserActive(true);
        await refreshStatus();
      }
      return success;
    } catch {
      // Neutral: no token, no payload, no stack.
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, refreshStatus]);

  /**
   * Unsubscribe THIS browser: removes only this device's token server-side and
   * tears down the browser subscription.
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const success = await pushManager.unsubscribe();
      if (success) {
        setThisBrowserActive(false);
        // Account may still have other devices: re-sync the account-level flag.
        await refreshStatus();
      }
      return success;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [refreshStatus]);

  const canSubscribe = isSupported && permission !== 'denied' && !thisBrowserActive;

  return {
    isSupported,
    permission,
    accountHasPush,
    thisBrowserActive,
    isLoading,
    subscribe,
    unsubscribe,
    refreshStatus,
    canSubscribe,
  };
}
