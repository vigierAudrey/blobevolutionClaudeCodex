/**
 * Firebase Configuration for Blobinfini PWA Push Notifications
 */

import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, type Messaging, type MessagePayload } from 'firebase/messaging';

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

// Initialize Firebase Cloud Messaging and get a reference to the service
let messaging: Messaging | null = null;

// Initialize messaging only in browser environment
if (typeof window !== 'undefined') {
  try {
    messaging = getMessaging(app);
    console.log('🔥 Firebase Messaging initialized');
  } catch (error) {
    console.error('❌ Firebase Messaging initialization failed:', error);
  }
}

/**
 * Request notification permission and get FCM token
 */
export async function requestNotificationPermission(): Promise<string | null> {
  if (!messaging) {
    console.error('❌ Firebase Messaging not available');
    return null;
  }

  try {
    // Check if notifications are supported
    if (!('Notification' in window)) {
      console.error('❌ This browser does not support desktop notification');
      return null;
    }

    // Check current permission
    let permission = Notification.permission;

    // Request permission if needed
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      console.log('🚫 Notification permission denied');
      return null;
    }

    // Register service worker if not already registered
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });
      console.log('✅ Service Worker registered:', registration);

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;
    }

    // Get FCM token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.getRegistration()
    });

    if (token) {
      console.log('🎯 FCM Token generated:', token.substring(0, 20) + '...');
      return token;
    } else {
      console.log('❌ No registration token available');
      return null;
    }

  } catch (error) {
    console.error('❌ Error getting notification permission:', error);
    return null;
  }
}

/**
 * Subscribe to FCM token refresh
 */
export function onTokenRefresh(callback: (token: string) => void) {
  if (!messaging) return () => {};

  // Listen for token refresh
  return onMessage(messaging, (payload: MessagePayload) => {
    console.log('🔄 Token refreshed or message received:', payload);

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
    new Notification(notification.title || 'Blobinfini', {
      body: notification.body,
      icon: notification.icon || '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'blobinfini-foreground',
      requireInteraction: false
    });
  }
}

/**
 * Send FCM token to backend
 */
export async function saveFCMToken(token: string, userId?: string): Promise<boolean> {
  try {
    const response = await fetch('/api/push/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`
      },
      body: JSON.stringify({
        token,
        userId,
        userAgent: navigator.userAgent,
        timestamp: Date.now()
      })
    });

    if (response.ok) {
      console.log('✅ FCM Token saved to backend');
      return true;
    } else {
      console.error('❌ Failed to save FCM token:', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ Error saving FCM token:', error);
    return false;
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        console.log('✅ Unsubscribed from push notifications');
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('❌ Error unsubscribing from push:', error);
    return false;
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
