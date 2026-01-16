/**
 * React Hook for Push Notifications in Blobinfini
 * Provides easy integration of push notifications in React components
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
  requestPermission: (customMessage?: string) => Promise<boolean>;
  testNotification: () => Promise<boolean>;

  // Utils
  showPermissionPrompt: boolean;
  canSubscribe: boolean;
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isLoading, setIsLoading] = useState(false);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);

  // Initialize and check current state
  useEffect(() => {
    const checkStatus = () => {
      setIsSubscribed(pushManager.isSubscribed());
      setIsSupported('Notification' in window && 'serviceWorker' in navigator);
      setPermission(pushManager.getPermissionStatus());
    };

    checkStatus();

    // Check if we should show permission prompt
    const hasSeenPrompt = localStorage.getItem('hasSeenPushPrompt');
    const isLoggedIn = !!localStorage.getItem('accessToken');

    if (!hasSeenPrompt && isLoggedIn && permission === 'default') {
      // Show prompt after a delay to not be too intrusive
      const timer = setTimeout(() => {
        setShowPermissionPrompt(true);
      }, 5000); // 5 seconds after component mounts

      return () => clearTimeout(timer);
    }
  }, [permission]);

  /**
   * Subscribe to push notifications
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      console.log('❌ Push notifications not supported');
      return false;
    }

    setIsLoading(true);

    try {
      const userId = getCurrentUserId();
      const success = await pushManager.subscribe(userId);

      if (success) {
        setIsSubscribed(true);
        setPermission('granted');
        localStorage.setItem('hasSeenPushPrompt', 'true');
        setShowPermissionPrompt(false);

        // Track subscription success
        trackPushEvent('subscribe_success', { userId });
      }

      return success;
    } catch (error: unknown) {
      console.error('❌ Error subscribing to push notifications:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      trackPushEvent('subscribe_error', { error: errorMessage });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  /**
   * Unsubscribe from push notifications
   */
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);

    try {
      const success = await pushManager.unsubscribe();

      if (success) {
        setIsSubscribed(false);
        trackPushEvent('unsubscribe_success');
      }

      return success;
    } catch (error: unknown) {
      console.error('❌ Error unsubscribing from push notifications:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      trackPushEvent('unsubscribe_error', { error: errorMessage });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Request permission with custom dialog
   */
  const requestPermission = useCallback(async (customMessage?: string): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    setIsLoading(true);

    try {
      const granted = await pushManager.promptForPermission(customMessage);

      if (granted) {
        setPermission('granted');
        // Automatically subscribe if permission granted
        const subscribed = await subscribe();
        return subscribed;
      } else {
        setPermission(pushManager.getPermissionStatus());
        localStorage.setItem('hasSeenPushPrompt', 'true');
        setShowPermissionPrompt(false);
        trackPushEvent('permission_denied');
        return false;
      }
    } catch (error: unknown) {
      console.error('❌ Error requesting permission:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      trackPushEvent('permission_error', { error: errorMessage });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, subscribe]);

  /**
   * Send test notification
   */
  const testNotification = useCallback(async (): Promise<boolean> => {
    if (!isSubscribed) {
      console.log('❌ Not subscribed to notifications');
      return false;
    }

    try {
      const success = await pushManager.testNotification();
      trackPushEvent('test_notification', { success });
      return success;
    } catch (error: unknown) {
      console.error('❌ Error sending test notification:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      trackPushEvent('test_notification_error', { error: errorMessage });
      return false;
    }
  }, [isSubscribed]);

  // Computed properties
  const canSubscribe = isSupported && permission !== 'denied' && !isSubscribed;

  return {
    // State
    isSubscribed,
    isSupported,
    permission,
    isLoading,

    // Actions
    subscribe,
    unsubscribe,
    requestPermission,
    testNotification,

    // Utils
    showPermissionPrompt,
    canSubscribe
  };
}

/**
 * React Hook for showing permission prompt component
 */
export function usePushPermissionPrompt() {
  const { showPermissionPrompt, requestPermission, canSubscribe } = usePushNotifications();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(showPermissionPrompt && canSubscribe);
  }, [showPermissionPrompt, canSubscribe]);

  const handleAccept = useCallback(async () => {
    const success = await requestPermission();
    setIsVisible(false);
    return success;
  }, [requestPermission]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem('hasSeenPushPrompt', 'true');
    setIsVisible(false);
    trackPushEvent('prompt_dismissed');
  }, []);

  return {
    isVisible,
    handleAccept,
    handleDismiss
  };
}

/**
 * React Hook for automatic push subscription on login
 */
export function useAutoPushSubscription() {
  const { subscribe, isSubscribed, canSubscribe } = usePushNotifications();
  const [hasAttemptedAutoSubscribe, setHasAttemptedAutoSubscribe] = useState(false);

  useEffect(() => {
    const attemptAutoSubscription = async () => {
      // Only attempt once per session
      if (hasAttemptedAutoSubscribe) return;

      // Check if user previously granted permission
      const hasSubscribedBefore = localStorage.getItem('pushSubscribed') === 'true';
      const isLoggedIn = !!localStorage.getItem('accessToken');

      if (hasSubscribedBefore && isLoggedIn && canSubscribe) {
        console.log('🔄 Attempting auto-subscription to push notifications');
        const success = await subscribe();

        if (success) {
          console.log('✅ Auto-subscribed to push notifications');
        } else {
          console.log('❌ Auto-subscription failed');
        }
      }

      setHasAttemptedAutoSubscribe(true);
    };

    attemptAutoSubscription();
  }, [subscribe, canSubscribe, hasAttemptedAutoSubscribe]);

  return {
    hasAttemptedAutoSubscribe
  };
}

// Helper functions

/**
 * Get current user ID from storage or context
 */
function getCurrentUserId(): string | undefined {
  // Try to get from localStorage first
  const userId = localStorage.getItem('userId');
  if (userId) return userId;

  // Could also get from auth context or JWT token
  const token = localStorage.getItem('accessToken');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.sub || payload.userId;
    } catch (error: unknown) {
      console.error('Error parsing token:', error);
    }
  }

  return undefined;
}

/**
 * Track push notification events for analytics
 */
function trackPushEvent(event: string, data?: Record<string, any>) {
  try {
    // Send to analytics endpoint
    fetch('/api/analytics/push-events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event,
        data,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        url: window.location.href
      })
    }).catch((error: unknown) => {
      console.log('📊 Analytics tracking failed:', error);
    });

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 Push Event: ${event}`, data);
    }
  } catch (error: unknown) {
    console.error('Error tracking push event:', error);
  }
}