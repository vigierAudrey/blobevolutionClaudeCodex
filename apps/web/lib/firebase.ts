/**
 * Firebase Configuration for Blobinfini PWA Push Notifications
 */

import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, type Messaging, type MessagePayload } from 'firebase/messaging';
import { apiRequest } from './csrf';

// Firebase config - These should be environment variables in production
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "blobinfini-demo.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "blobinfini-demo",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "blobinfini-demo.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:123456789:web:abcdef123456",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-ABCDEF123"
};

// VAPID key for push notifications (public key)
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "demo-vapid-key";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Firebase Cloud Messaging is resolved lazily: we never call getMessaging at
// module load. This avoids eager support-check side effects in unsupported
// environments (SSR, tests, locked-down browsers) and keeps push fully off
// until a user action actually needs it. If unavailable, push simply stays off —
// no raw provider error is surfaced or logged.
let messaging: Messaging | null = null;
let messagingResolved = false;

function getMessagingInstance(): Messaging | null {
  if (messagingResolved) return messaging;
  messagingResolved = true;

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    messaging = getMessaging(app);
  } catch {
    messaging = null;
  }
  return messaging;
}

/**
 * Request notification permission and get FCM token.
 * Must only be called after an explicit, user-initiated action.
 * Returns null on any failure (unsupported, denied, provider error) without
 * leaking the token or the underlying provider error.
 */
export async function requestNotificationPermission(): Promise<string | null> {
  const messagingInstance = getMessagingInstance();
  if (!messagingInstance) {
    return null;
  }

  try {
    // Check if notifications are supported
    if (!('Notification' in window)) {
      return null;
    }

    // Check current permission
    let permission = Notification.permission;

    // Request permission if needed (only reached on a user-initiated call)
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return null;
    }

    // Register service worker if not already registered
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;
    }

    // Get FCM token
    const token = await getToken(messagingInstance, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.getRegistration()
    });

    // Never log the token (not even a prefix).
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to foreground messages.
 * The payload is never logged (it may carry sensitive content).
 */
export function onTokenRefresh(callback: (token: string) => void) {
  const messagingInstance = getMessagingInstance();
  if (!messagingInstance) return () => {};

  return onMessage(messagingInstance, (payload: MessagePayload) => {
    // Handle foreground messages
    if (payload.notification) {
      // Show notification when app is in foreground
      showForegroundNotification(payload.notification);
    }

    const refreshedToken = payload.data?.token;
    if (refreshedToken) {
      callback(refreshedToken);
    }
  });
}

/**
 * Show notification when app is in foreground
 */
type ForegroundNotification = {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  requireInteraction?: boolean;
};

function showForegroundNotification(notification: ForegroundNotification) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(notification.title || 'Blob', {
      body: notification.body,
      icon: notification.icon || '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'blobinfini-foreground',
      requireInteraction: false
    });
  }
}

/**
 * Register this browser's FCM token with the backend.
 *
 * Security: the user identity is resolved server-side from the auth cookie.
 * The front NEVER sends a userId — it only sends the device token. Auth is
 * carried by the httpOnly session cookie via apiRequest (no localStorage Bearer).
 */
export async function saveFCMToken(token: string): Promise<boolean> {
  try {
    const response = await apiRequest('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        token,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        timestamp: Date.now(),
      }),
    });
    return response.ok;
  } catch {
    // Neutral failure: no token, no payload, no stack surfaced.
    return false;
  }
}

/**
 * Remove this browser's push token on the backend and tear down the local
 * browser subscription. Identity is resolved server-side from the auth cookie;
 * no userId is sent.
 */
export async function unregisterFCMToken(): Promise<boolean> {
  let apiOk = false;
  try {
    const response = await apiRequest('/push/unregister', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    apiOk = response.ok;
  } catch {
    apiOk = false;
  }

  // Best-effort teardown of the browser-level subscription.
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
  } catch {
    // Ignore: the server-side removal is the source of truth.
  }

  return apiOk;
}

/**
 * Query the server for this account's push status.
 * Returns whether the account has active tokens, or null when unavailable
 * (feature disabled, network error). Never throws, never logs sensitive data.
 */
export async function fetchPushStatus(): Promise<{ hasActiveTokens: boolean } | null> {
  try {
    const response = await apiRequest('/push/status', { method: 'GET' });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!data || typeof data.hasActiveTokens !== 'boolean') return null;
    return { hasActiveTokens: data.hasActiveTokens };
  } catch {
    return null;
  }
}

/**
 * Check if push notifications are supported and enabled
 */
export function isPushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Get current notification permission status
 */
export function getNotificationPermission(): NotificationPermission {
  if ('Notification' in window) {
    return Notification.permission;
  }
  return 'default';
}

export { messaging };
