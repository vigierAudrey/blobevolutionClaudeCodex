import fs from 'fs';
import path from 'path';
import vm from 'vm';

type ServiceWorkerHandlers = {
  push?: (event: { data?: { json: () => unknown }; waitUntil: (promise: Promise<unknown>) => void }) => void;
};

function loadServiceWorker() {
  const handlers: ServiceWorkerHandlers = {};
  const showNotification = jest.fn().mockResolvedValue(undefined);
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
    self: {
      location: { origin: 'https://blobsurf.test' },
      registration: { showNotification },
      skipWaiting: jest.fn(),
      clients: {
        claim: jest.fn(),
        matchAll: jest.fn(),
        openWindow: jest.fn(),
      },
      addEventListener: jest.fn((type: keyof ServiceWorkerHandlers, handler: ServiceWorkerHandlers[keyof ServiceWorkerHandlers]) => {
        handlers[type] = handler;
      }),
    },
  });

  const source = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  vm.runInContext(source, context);

  return { handlers, showNotification };
}

describe('public/sw.js push handling', () => {
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
