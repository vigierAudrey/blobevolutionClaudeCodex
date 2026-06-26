/**
 * Blobinfini Service Worker
 * Handles push notifications for messages and alerts
 */

// Cache name for this version — bump this string to force cache invalidation on all clients.
// IMPORTANT: never add HTML pages (like '/') to this list — they must always come from the
// network so users see the latest deployed content rather than a stale cached version.
const CACHE_NAME = 'blobinfini-v3';
const CACHE_NAME_PREFIX = 'blobinfini-';
const urlsToCache = [
  '/offline.html',
  '/icons/icon-192x192.png'
];
const MAX_NOTIFICATION_TEXT_LENGTH = 180;

function safeText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, MAX_NOTIFICATION_TEXT_LENGTH);
}

function safeClientPath(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return fallback;
  }
}

function normalizeNotificationData(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const data = source.data && typeof source.data === 'object' ? source.data : {};
  const type = ['new_message', 'reminder', 'general'].includes(source.type) ? source.type : 'general';
  const url = safeClientPath(source.url || data.url || data.defaultUrl, '/dashboard');

  return {
    title: safeText(source.title, 'Blob'),
    body: safeText(source.body, 'Nouvelle notification'),
    icon: safeClientPath(source.icon, '/icons/icon-192x192.png'),
    badge: safeClientPath(source.badge, '/icons/icon-72x72.png'),
    tag: safeText(source.tag, 'blobinfini-notification'),
    type,
    data: {
      conversationId: safeText(data.conversationId, ''),
      messageUrl: safeClientPath(data.messageUrl, url),
      viewUrl: safeClientPath(data.viewUrl, url),
      defaultUrl: url,
      url
    },
    requireInteraction: Boolean(source.requireInteraction),
    silent: Boolean(source.silent)
  };
}

// Install event - cache essential resources
self.addEventListener('install', function(event) {
  console.log('🏄 BlobConnect SW: Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('📦 SW: Caching app resources');
        return cache.addAll(urlsToCache);
      })
  );

  // Force activation of new service worker
  self.skipWaiting();
});

// Activate event - purge ALL previous blobinfini-* caches so stale pages are cleared immediately.
self.addEventListener('activate', function(event) {
  console.log('✅ BlobConnect SW: Activated');

  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(cacheName) {
            // Delete every blobinfini-* cache that is not the current version.
            return cacheName.startsWith(CACHE_NAME_PREFIX) && cacheName !== CACHE_NAME;
          })
          .map(function(cacheName) {
            console.log('🗑️ SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );

  // Take control of all pages immediately so the new SW handles all fetches.
  self.clients.claim();
});

// Push event - handle incoming push notifications
self.addEventListener('push', function(event) {
  console.log('📬 SW: Push received');

  let notificationData = {
    title: 'Blob',
    body: 'Nouvelle notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: 'blobinfini-notification',
    requireInteraction: false,
    silent: false
  };

  // Parse push data if available
  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = normalizeNotificationData({
        ...notificationData,
        ...data
      });
    } catch (_error) {
      console.warn('📬 SW: Invalid push data format');
      notificationData = normalizeNotificationData(notificationData);
    }
  } else {
    notificationData = normalizeNotificationData(notificationData);
  }

  // Add appropriate actions based on notification type
  const actions = [];

  if (notificationData.type === 'new_message') {
    actions.push(
      { action: 'reply', title: '↩️ Répondre', icon: '/icons/action-reply.png' },
      { action: 'view', title: '👀 Voir la conversation', icon: '/icons/action-view.png' }
    );
  }

  if (actions.length > 0) {
    notificationData.actions = actions;
    notificationData.requireInteraction = true; // Keep visible until user interacts
  }

  // Add vibration pattern based on type
  const vibrationPatterns = {
    new_message: [150], // Simple buzz
    reminder: [300, 100, 300], // Attention pattern
    default: [200]
  };

  notificationData.vibrate = vibrationPatterns[notificationData.type] || vibrationPatterns.default;

  // Show the notification
  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
      .catch(_error => {
        console.error('❌ SW: Failed to show notification');
      })
  );
});

// Notification click event - handle user interactions
self.addEventListener('notificationclick', function(event) {
  console.log('👆 SW: Notification clicked', event.action);

  const notification = event.notification;
  const data = notification.data || {};

  // Close the notification
  notification.close();

  let urlToOpen = '/dashboard'; // Default fallback

  // Handle different actions
  switch (event.action) {
    case 'view':
      urlToOpen = safeClientPath(data.url || data.viewUrl, '/dashboard');
      break;
    case 'message':
      urlToOpen = safeClientPath(data.messageUrl || `/messages/${data.conversationId || ''}`, '/dashboard');
      break;
    case 'reply':
      urlToOpen = safeClientPath(data.messageUrl || `/messages/${data.conversationId || ''}`, '/dashboard');
      break;
    case 'search':
      urlToOpen = '/matching';
      break;
    default:
      // No action = click on notification body
      urlToOpen = safeClientPath(data.url || data.defaultUrl, '/dashboard');
  }

  // Open the appropriate page
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {

        // Check if app is already open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(urlToOpen.split('?')[0]) && 'focus' in client) {
            console.log('🎯 SW: Focusing existing tab');
            return client.focus();
          }
        }

        // If no matching tab, check if any Blobinfini tab is open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.location.origin) && 'navigate' in client) {
            console.log('🚀 SW: Navigating existing tab');
            return client.navigate(urlToOpen).then(client => client.focus());
          }
        }

        // No app open, open new window/tab
        console.log('🆕 SW: Opening new tab');
        return clients.openWindow(urlToOpen);
      })
      .catch(_error => {
        console.error('❌ SW: Failed to handle notification click');
      })
  );
});

// Notification close event
self.addEventListener('notificationclose', function(event) {
  console.log('❌ SW: Notification dismissed');
});

// Background sync for offline actions (Phase 2 feature)
self.addEventListener('sync', function(event) {
  if (event.tag === 'background-sync-blobinfini') {
    console.log('🔄 SW: Background sync triggered');
    event.waitUntil(
      // Could sync offline actions like messages, bookings, etc.
      Promise.resolve()
    );
  }
});

// Handle fetch events for offline capability
self.addEventListener('fetch', function(event) {
  // Only handle GET requests for caching
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // Network-first for HTML navigations: always fetch fresh content from the server.
  // Fall back to offline.html only when the network is completely unreachable.
  // This prevents stale pages from being served after a deployment.
  if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .catch(function() {
          return caches.match('/offline.html');
        })
    );
    return;
  }

  // Cache-first for static assets (images, fonts, icons…) on the same origin.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request)
        .then(function(response) {
          return response || fetch(event.request)
            .catch(function() {
              // Nothing to fall back to for static assets — let the browser handle it.
            });
        })
    );
  }
});

console.log('🏄 BlobConnect Service Worker loaded successfully!');
