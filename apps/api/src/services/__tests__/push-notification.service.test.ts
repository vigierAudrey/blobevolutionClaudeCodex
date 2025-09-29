import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { SpyInstance } from 'jest-mock';
import { PushNotificationService, type PushNotificationData } from '../push-notification.service';

// --- Firebase admin mock ----------------------------------------------------
var adminMock: any;
var messagingMock: any;

jest.mock('firebase-admin', () => {
  messagingMock = {
    send: jest.fn(async () => 'mock-message-id')
  };

  adminMock = {
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    messaging: jest.fn(() => messagingMock),
    apps: [] as unknown[]
  };

  return { __esModule: true, default: adminMock };
});

const ORIGINAL_ENV = { ...process.env };

const setFirebaseEnv = (enabled: boolean) => {
  if (enabled) {
    process.env.FIREBASE_PROJECT_ID = 'test-project-id';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----\\n';
  } else {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  }
};

const createService = (withCredentials = true) => {
  setFirebaseEnv(withCredentials);
  adminMock.apps.length = 0;
  return new PushNotificationService();
};

const muteConsole = () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  return () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  };
};

describe('PushNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminMock.apps.length = 0;
  });

  afterEach(() => {
    setFirebaseEnv(true); // default back to valid
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('initialisation', () => {
    it('marks service as initialised when credentials are provided', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      setFirebaseEnv(true);
      adminMock.apps.length = 0;

      await jest.isolateModulesAsync(async () => {
        const { PushNotificationService: LocalService } = await import('../push-notification.service');
        const instance = new LocalService();
        expect(instance['isInitialized']).toBe(true);
      });

      expect(logSpy).toHaveBeenCalledWith('✅ Push Notification Service initialized');
      logSpy.mockRestore();
    });

    it('skips Firebase init when credentials are missing', () => {
      const restoreConsole = muteConsole();
      createService(false);

      expect(adminMock.initializeApp).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('⚠️ Firebase credentials not configured, push notifications disabled');
      restoreConsole();
    });
  });

  describe('token lifecycle', () => {
    it('saves tokens without failing', async () => {
      const restoreConsole = muteConsole();
      const service = createService(false);

      await expect(service.saveToken('user-1', 'token-xyz')).resolves.toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('💾 Saving FCM token for user user-1'));
      restoreConsole();
    });

    it('returns false when an error occurs while saving', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const service = createService(false);
      jest.spyOn(console, 'log').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      await expect(service.saveToken('user-1', 'token-xyz')).resolves.toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Error saving FCM token:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('removes tokens and logs the action', async () => {
      const restoreConsole = muteConsole();
      const service = createService(false);

      await expect(service.removeToken('user-1', 'token-xyz')).resolves.toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🗑️ Removing FCM token for user user-1'));
      restoreConsole();
    });

    it('handles removal errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const service = createService(false);
      jest.spyOn(console, 'log').mockImplementation(() => {
        throw new Error('db unavailable');
      });

      await expect(service.removeToken('user-1')).resolves.toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Error removing FCM token:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe('sending notifications', () => {
    const sampleNotification: PushNotificationData = {
      title: 'Hello',
      body: 'world',
      type: 'general'
    };

    it('returns false when service is not initialised', async () => {
      const restoreConsole = muteConsole();
      const service = createService(false);

      await expect(service.sendToToken('token', sampleNotification)).resolves.toBe(false);
      expect(console.log).toHaveBeenCalledWith('⚠️ Push notifications not initialized');
      restoreConsole();
    });

    it('sends messages through Firebase when initialised', async () => {
      const service = createService(true);
      service['isInitialized'] = true;

      messagingMock.send.mockResolvedValue('message-id-1');
      await expect(service.sendToToken('token-xyz', sampleNotification)).resolves.toBe(true);
      expect(messagingMock.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'token-xyz' }));
    });

    it('marks invalid tokens as failures', async () => {
      const restoreConsole = muteConsole();
      const service = createService(true);
      service['isInitialized'] = true;

      const error: any = new Error('invalid');
      error.code = 'messaging/registration-token-not-registered';
      messagingMock.send.mockRejectedValue(error);

      await expect(service.sendToToken('bad-token', sampleNotification)).resolves.toBe(false);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🗑️ Token no longer valid'));
      restoreConsole();
    });

    it('propagates other send errors to the logger', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const service = createService(true);
      service['isInitialized'] = true;

      messagingMock.send.mockRejectedValue(new Error('timeout'));

      await expect(service.sendToToken('token', sampleNotification)).resolves.toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Error sending notification:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('broadcasts to each user token via sendToUser', async () => {
      const service = createService(true);
      service['isInitialized'] = true;

      jest.spyOn(service as any, 'getUserTokens').mockResolvedValue(['token-a', 'token-b']);
      messagingMock.send.mockResolvedValueOnce('ok-a').mockResolvedValueOnce('ok-b');

      await expect(service.sendToUser('user-1', sampleNotification)).resolves.toBe(true);
      expect(messagingMock.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('shortcut notifications', () => {
    let service: PushNotificationService;
    let sendSpy: SpyInstance<(userId: string, payload: PushNotificationData) => Promise<boolean>>;

    beforeEach(() => {
      service = createService(true);
      service['isInitialized'] = true;
      sendSpy = jest.spyOn(service, 'sendToUser').mockResolvedValue(true);
    });

    afterEach(() => {
      sendSpy.mockRestore();
    });

    it('sends booking accepted payload', async () => {
      await service.sendBookingAccepted('user-1', {
        proName: 'Jean Surf',
        spotName: 'La Gravière',
        dateTime: '2024-02-10T09:00:00Z',
        conversationId: 'conv-1'
      });

      expect(sendSpy).toHaveBeenCalledWith('user-1', expect.objectContaining({
        type: 'booking_accepted',
        data: expect.objectContaining({ conversationId: 'conv-1' })
      }));
    });

    it('truncates long messages in sendNewMessage', async () => {
      await service.sendNewMessage('user-1', {
        senderName: 'Jean',
        message: 'x'.repeat(80),
        conversationId: 'conv-2'
      });

      expect(sendSpy).toHaveBeenCalledWith('user-1', expect.objectContaining({
        body: 'x'.repeat(50) + '...'
      }));
    });
  });

  describe('helpers', () => {
    it('builds a full FCM message payload', () => {
      const service = createService(true);
      service['isInitialized'] = true;

      const message = (service as any).buildFCMMessage('token', {
        title: 'Hello',
        body: 'World',
        type: 'booking_accepted',
        userId: 'user-1',
        url: '/test',
        data: { extra: 'value' }
      });

      expect(message).toMatchObject({
        token: 'token',
        data: expect.objectContaining({ type: 'booking_accepted', extra: 'value' }),
        webpush: expect.any(Object)
      });
    });

    it('detects platforms from user agents', () => {
      const service = createService(false);
      expect((service as any).getPlatformFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)')).toBe('ios');
      expect((service as any).getPlatformFromUserAgent('Mozilla/5.0 (Linux; Android)')).toBe('android');
      expect((service as any).getPlatformFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
      expect((service as any).getPlatformFromUserAgent('UnknownBrowser/1.0')).toBe('web');
      expect((service as any).getPlatformFromUserAgent(undefined)).toBe('unknown');
    });
  });
});
