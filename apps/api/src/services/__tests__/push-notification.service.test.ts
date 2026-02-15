import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { PushNotificationService, type PushNotificationData } from '../push-notification.service';
import { secureLogger } from '../../utils/secure-logger';
import { clientPrisma as prisma } from '@blobinfini/database';
import bcrypt from 'bcryptjs';

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
let infoSpy: jest.SpiedFunction<typeof secureLogger.info>;
let warnSpy: jest.SpiedFunction<typeof secureLogger.warn>;
let errorSpy: jest.SpiedFunction<typeof secureLogger.error>;
let debugSpy: jest.SpiedFunction<typeof secureLogger.debug>;

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

const ensureTestUser = async (userId: string) => {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@test.local`,
        password: await bcrypt.hash('test-password', 12),
        role: 'RIDER',
        consentedAt: new Date(),
        consentVersion: 'v1.0.0',
      },
    });
  }
};

describe('PushNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    adminMock.apps.length = 0;
    infoSpy = jest.spyOn(secureLogger, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(secureLogger, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(secureLogger, 'error').mockImplementation(() => {});
    debugSpy = jest.spyOn(secureLogger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
    setFirebaseEnv(true); // default back to valid
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } });
    await prisma.$disconnect();
    process.env = { ...ORIGINAL_ENV };
  });

  describe('initialisation', () => {
    it('marks service as initialised when credentials are provided', () => {
      setFirebaseEnv(true);
      adminMock.apps.length = 0;

      jest.isolateModules(() => {
        const { secureLogger: isolatedLogger } =
          jest.requireActual<typeof import('../../utils/secure-logger')>('../../utils/secure-logger');
        const infoSpyLocal = jest.spyOn(isolatedLogger, 'info').mockImplementation(() => {});
        const { PushNotificationService: LocalService } =
          jest.requireActual<typeof import('../push-notification.service')>('../push-notification.service');
        const instance = new LocalService();
        expect(instance['isInitialized']).toBe(true);
        expect(infoSpyLocal).toHaveBeenCalledWith(
          'PUSH_SERVICE_INITIALIZED',
          expect.objectContaining({ projectId: 'test-project-id' })
        );
        infoSpyLocal.mockRestore();
      });
    });

    it('skips Firebase init when credentials are missing', () => {
      createService(false);

      expect(adminMock.initializeApp).not.toHaveBeenCalled();
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_SERVICE_DISABLED', { reason: 'missing_credentials' });
    });
  });

  describe('token lifecycle', () => {
    it('saves tokens without failing', async () => {
      await ensureTestUser('user-1');
      const service = createService(false);

      await expect(service.saveToken('user-1', 'token-xyz')).resolves.toBe(true);
      expect(secureLogger.info).toHaveBeenCalledWith('PUSH_TOKEN_SAVE', { userId: 'user-1' });
    });

    it('returns false when an error occurs while saving', async () => {
      await ensureTestUser('user-1');
      const service = createService(false);
      infoSpy.mockImplementationOnce(() => {
        throw new Error('storage unavailable');
      });

      await expect(service.saveToken('user-1', 'token-xyz')).resolves.toBe(false);
      expect(secureLogger.error).toHaveBeenCalledWith(
        'PUSH_TOKEN_SAVE_FAILED',
        expect.objectContaining({ userId: 'user-1', error: 'storage unavailable' })
      );
      infoSpy.mockImplementation(() => {});
    });

    it('removes tokens and logs the action', async () => {
      await ensureTestUser('user-1');
      const service = createService(false);

      await expect(service.removeToken('user-1', 'token-xyz')).resolves.toBe(true);
      expect(secureLogger.info).toHaveBeenCalledWith('PUSH_TOKEN_REMOVE', { userId: 'user-1', hasToken: true });
    });

    it('handles removal errors gracefully', async () => {
      await ensureTestUser('user-1');
      const service = createService(false);
      infoSpy.mockImplementationOnce(() => {
        throw new Error('db unavailable');
      });

      await expect(service.removeToken('user-1')).resolves.toBe(false);
      expect(secureLogger.error).toHaveBeenCalledWith(
        'PUSH_TOKEN_REMOVE_FAILED',
        expect.objectContaining({ userId: 'user-1', error: 'db unavailable' })
      );
      infoSpy.mockImplementation(() => {});
    });
  });

  describe('sending notifications', () => {
    const sampleNotification: PushNotificationData = {
      title: 'Hello',
      body: 'world',
      type: 'general'
    };

    it('returns false when service is not initialised', async () => {
      const service = createService(false);

      await expect(service.sendToToken('token', sampleNotification)).resolves.toBe(false);
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_SERVICE_NOT_INITIALIZED', { reason: 'send_to_token' });
    });

    it('sends messages through Firebase when initialised', async () => {
      const service = createService(true);
      service['isInitialized'] = true;

      messagingMock.send.mockResolvedValue('message-id-1');
      await expect(service.sendToToken('token-xyz', sampleNotification)).resolves.toBe(true);
      expect(messagingMock.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'token-xyz' }));
      expect(secureLogger.info).toHaveBeenCalledWith(
        'PUSH_TOKEN_SENT',
        expect.objectContaining({ responseId: 'message-id-1' })
      );
    });

    it('marks invalid tokens as failures', async () => {
      const service = createService(true);
      service['isInitialized'] = true;

      const error: any = new Error('invalid');
      error.code = 'messaging/registration-token-not-registered';
      messagingMock.send.mockRejectedValue(error);

      await expect(service.sendToToken('bad-token', sampleNotification)).resolves.toBe(false);
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_TOKEN_INVALID', { errorCode: error.code });
    });

    it('propagates other send errors to the logger', async () => {
      const service = createService(true);
      service['isInitialized'] = true;

      messagingMock.send.mockRejectedValue(new Error('timeout'));

      await expect(service.sendToToken('token', sampleNotification)).resolves.toBe(false);
      expect(secureLogger.error).toHaveBeenCalledWith(
        'PUSH_TOKEN_SEND_FAILED',
        expect.objectContaining({ error: 'timeout' })
      );
    });

    it('broadcasts to each user token via sendToUser', async () => {
      await ensureTestUser('user-1');
      const service = createService(true);
      service['isInitialized'] = true;

      jest.spyOn(service as any, 'getUserTokens').mockResolvedValue(['token-a', 'token-b']);
      messagingMock.send.mockResolvedValueOnce('ok-a').mockResolvedValueOnce('ok-b');

      await expect(service.sendToUser('user-1', sampleNotification)).resolves.toBe(true);
      expect(messagingMock.send).toHaveBeenCalledTimes(2);
      expect(secureLogger.info).toHaveBeenCalledWith(
        'PUSH_NOTIFICATION_SENT',
        expect.objectContaining({ userId: 'user-1', successCount: 2, total: 2 })
      );
    });
  });

  describe('shortcut notifications', () => {
    let service: PushNotificationService;
    let sendSpy: jest.SpiedFunction<(userId: string, payload: PushNotificationData) => Promise<boolean>>;

    beforeEach(async () => {
      await ensureTestUser('user-1');
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
