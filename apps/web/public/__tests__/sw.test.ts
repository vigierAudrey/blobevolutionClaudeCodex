import fs from 'fs';
import path from 'path';
import vm from 'vm';

type ServiceWorkerHandlers = {
  push?: (event: { data?: { json: () => unknown }; waitUntil: (promise: Promise<unknown>) => void }) => void;
  notificationclick?: (event: {
    action: string;
    notification: { data?: Record<string, unknown>; close: () => void };
    waitUntil: (promise: Promise<unknown>) => void;
  }) => void;
};

function loadServiceWorker() {
  const handlers: ServiceWorkerHandlers = {};
  const showNotification = jest.fn().mockResolvedValue(undefined);
  const clients = {
    claim: jest.fn(),
    matchAll: jest.fn().mockResolvedValue([]),
    openWindow: jest.fn().mockResolvedValue(undefined),
  };
  const context = vm.createContext({
    URL,
    Promise,
    Boolean,
    console: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    caches: {
      open: jest.fn(),
      keys: jest.fn(),
      match: jest.fn(),
      delete: jest.fn(),
    },
    fetch: jest.fn(),
    clients,
    self: {
      location: { origin: 'https://blobsurf.test' },
      registration: { showNotification },
      skipWaiting: jest.fn(),
      clients,
      addEventListener: jest.fn((type: keyof ServiceWorkerHandlers, handler: ServiceWorkerHandlers[keyof ServiceWorkerHandlers]) => {
        handlers[type] = handler;
      }),
    },
  });

  const source = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  vm.runInContext(source, context);

  return { handlers, showNotification, clients };
}

describe('public/sw.js push handling', () => {
  it('uses fallback notification data when event.data is absent', async () => {
    const { handlers, showNotification } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    handlers.push?.({
      waitUntil: (promise) => waits.push(promise),
    });

    await Promise.all(waits);

    expect(showNotification).toHaveBeenCalledWith(
      'Blob',
      expect.objectContaining({
        body: 'Nouvelle notification',
        type: 'general',
        data: expect.objectContaining({
          url: '/dashboard',
          defaultUrl: '/dashboard',
        }),
      }),
    );
  });

  it('uses fallback notification data when payload is empty', async () => {
    const { handlers, showNotification } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    handlers.push?.({
      data: {
        json: () => ({}),
      },
      waitUntil: (promise) => waits.push(promise),
    });

    await Promise.all(waits);

    expect(showNotification).toHaveBeenCalledWith(
      'Blob',
      expect.objectContaining({
        body: 'Nouvelle notification',
        type: 'general',
        data: expect.objectContaining({
          url: '/dashboard',
          defaultUrl: '/dashboard',
        }),
      }),
    );
  });

  it('uses fallback notification data when push JSON parsing fails', async () => {
    const { handlers, showNotification } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    handlers.push?.({
      data: {
        json: () => {
          throw new SyntaxError('invalid json');
        },
      },
      waitUntil: (promise) => waits.push(promise),
    });

    await Promise.all(waits);

    expect(showNotification).toHaveBeenCalledWith(
      'Blob',
      expect.objectContaining({
        body: 'Nouvelle notification',
        type: 'general',
        data: expect.objectContaining({
          url: '/dashboard',
          defaultUrl: '/dashboard',
        }),
      }),
    );
  });

  it('normalizes nested FCM payloads and keeps navigation same-origin', async () => {
    const { handlers, showNotification } = loadServiceWorker();
    const waits: Promise<unknown>[] = [];

    handlers.push?.({
      data: {
        json: () => ({
          notification: {
            title: 'Nouveau message',
            body: 'Un rider t a ecrit',
          },
          data: {
            type: 'new_message',
            conversationId: 'conversation-1',
            messageUrl: 'https://evil.example/messages/conversation-1',
          },
          webpush: {
            notification: {
              tag: 'blobinfini-new-message',
              data: {
                url: '/messages/conversation-1?from=push',
                viewUrl: '/messages/conversation-1',
              },
            },
            fcmOptions: {
              link: '/messages/conversation-1?from=fcm',
            },
          },
        }),
      },
      waitUntil: (promise) => waits.push(promise),
    });

    await Promise.all(waits);

    expect(showNotification).toHaveBeenCalledWith(
      'Nouveau message',
      expect.objectContaining({
        body: 'Un rider t a ecrit',
        tag: 'blobinfini-new-message',
        type: 'new_message',
        requireInteraction: true,
        actions: expect.arrayContaining([
          expect.objectContaining({ action: 'reply' }),
          expect.objectContaining({ action: 'view' }),
        ]),
        data: expect.objectContaining({
          conversationId: 'conversation-1',
          url: '/messages/conversation-1?from=push',
          viewUrl: '/messages/conversation-1',
          messageUrl: '/messages/conversation-1?from=push',
        }),
      }),
    );
  });
});

describe('public/sw.js notification click handling', () => {
  it('opens a safe same-origin path from notification data', async () => {
    const { clients, handlers } = loadServiceWorker();
    const close = jest.fn();
    const waits: Promise<unknown>[] = [];

    handlers.notificationclick?.({
      action: '',
      notification: {
        data: { url: '/messages/conversation-1?from=push#latest' },
        close,
      },
      waitUntil: (promise) => waits.push(promise),
    });

    await Promise.all(waits);

    expect(close).toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledWith('/messages/conversation-1?from=push#latest');
  });

  it('falls back to same-origin dashboard for external notification URLs', async () => {
    const { clients, handlers } = loadServiceWorker();
    const close = jest.fn();
    const waits: Promise<unknown>[] = [];

    handlers.notificationclick?.({
      action: '',
      notification: {
        data: { url: 'https://evil.example/messages/conversation-1' },
        close,
      },
      waitUntil: (promise) => waits.push(promise),
    });

    await Promise.all(waits);

    expect(close).toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledWith('/dashboard');
  });
});
