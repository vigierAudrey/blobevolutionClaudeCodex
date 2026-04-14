/**
 * Blobinfini Service Worker
 * Handles push notifications for messages and alerts
 */

// Cache name for this version
const CACHE_NAME = 'blobinfini-v2';
const urlsToCache = [
  '/',
  '/offline.html',
  '/icons/icon-192x192.png'
];

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

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
  console.log('✅ BlobConnect SW: Activated');

  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  // Take control of all pages
  self.clients.claim();
});

// Push event - handle incoming push notifications
self.addEventListener('push', function(event) {
  console.log('📬 SW: Push received');

  let notificationData = {
    title: 'BlobConnect',
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
      notificationData = {
        ...notificationData,
        ...data
      };
    } catch (e) {
      console.error('📬 SW: Invalid push data format:', e);
      notificationData.body = event.data.text() || notificationData.body;
    }
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
      .catch(error => {
        console.error('❌ SW: Failed to show notification:', error);
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
      urlToOpen = data.url || data.viewUrl || '/dashboard';
      break;
    case 'message':
      urlToOpen = data.messageUrl || `/messages/${data.conversationId || ''}`;
      break;
    case 'reply':
      urlToOpen = data.messageUrl || `/messages/${data.conversationId || ''}`;
      break;
    case 'search':
      urlToOpen = '/matching';
      break;
    default:
      // No action = click on notification body
      urlToOpen = data.url || data.defaultUrl || '/dashboard';
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
      .catch(error => {
        console.error('❌ SW: Failed to handle notification click:', error);
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

  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Return cached version or fetch from network
        return response || fetch(event.request)
          .catch(function() {
            // If both cache and network fail, show offline page for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html');
            }
          });
      })
  );
});

console.log('🏄 BlobConnect Service Worker loaded successfully!');
