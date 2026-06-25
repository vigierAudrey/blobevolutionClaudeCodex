import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import {
  MAX_PUSH_TOKENS_PER_USER,
  PushNotificationService,
  type PushNotificationData,
} from '../push-notification.service';
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

const setPushFeatureFlag = (enabled: boolean) => {
  if (enabled) {
    process.env.PUSH_NOTIFICATIONS_ENABLED = 'true';
  } else {
    delete process.env.PUSH_NOTIFICATIONS_ENABLED;
  }
};

const createService = (withCredentials = true, pushEnabled = true) => {
  setFirebaseEnv(withCredentials);
  setPushFeatureFlag(pushEnabled);
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
    setPushFeatureFlag(true);
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
    setPushFeatureFlag(true);
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
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_SERVICE_DISABLED', { reason: 'missing_or_demo_credentials' });
    });

    it('is fail-closed: skips Firebase init when projectId is the demo placeholder', () => {
      // Real credentials present but the project is still the demo fallback → unusable.
      process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----\\n';
      process.env.FIREBASE_PROJECT_ID = 'blobinfini-demo';
      setPushFeatureFlag(true);
      adminMock.apps.length = 0;

      const service = new PushNotificationService();

      expect(service['isInitialized']).toBe(false);
      expect(adminMock.initializeApp).not.toHaveBeenCalled();
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_SERVICE_DISABLED', { reason: 'missing_or_demo_credentials' });
    });

    it('skips Firebase init when the push feature flag is off', () => {
      createService(true, false);

      expect(adminMock.initializeApp).not.toHaveBeenCalled();
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_SERVICE_DISABLED', { reason: 'feature_flag_off' });
    });
  });

  describe('token lifecycle', () => {
    it('saves tokens without failing', async () => {
      await ensureTestUser('user-1');
      const service = createService(false);

      await expect(service.saveToken('user-1', 'token-xyz')).resolves.toBe(true);
      expect(secureLogger.info).toHaveBeenCalledWith('PUSH_TOKEN_SAVE', { authenticated: true });
    });

    it('does not save tokens when the push feature flag is off', async () => {
      await ensureTestUser('user-1');
      await prisma.pushToken.deleteMany({ where: { userId: 'user-1' } });
      const service = createService(false, false);

      await expect(service.saveToken('user-1', 'token-xyz')).resolves.toBe(false);
      await expect(prisma.pushToken.count({ where: { userId: 'user-1' } })).resolves.toBe(0);
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_TOKEN_SAVE_SKIPPED', { reason: 'feature_flag_off' });
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
        { errorName: 'Error' },
      );
      infoSpy.mockImplementation(() => {});
    });

    it('removes tokens and logs the action', async () => {
      await ensureTestUser('user-1');
      const service = createService(false);

      await expect(service.removeToken('user-1', 'token-xyz')).resolves.toBe(true);
      expect(secureLogger.info).toHaveBeenCalledWith('PUSH_TOKEN_REMOVE', { hasToken: true });
    });

    it('does not remove tokens when the push feature flag is off', async () => {
      await ensureTestUser('user-1');
      await prisma.pushToken.upsert({
        where: { token: 'token-xyz' },
        create: { token: 'token-xyz', userId: 'user-1' },
        update: { userId: 'user-1' },
      });
      const service = createService(false, false);

      await expect(service.removeToken('user-1', 'token-xyz')).resolves.toBe(false);
      await expect(prisma.pushToken.count({ where: { userId: 'user-1' } })).resolves.toBe(1);
      expect(secureLogger.warn).toHaveBeenCalledWith('PUSH_TOKEN_REMOVE_SKIPPED', { reason: 'feature_flag_off' });
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
        { errorName: 'Error' },
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
      expect(secureLogger.info).toHaveBeenCalledWith('PUSH_TOKEN_SENT');
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
        { errorName: 'Error' },
      );
    });

    it('borne à cinq le nombre de tokens conservés par utilisateur', async () => {
      await ensureTestUser('user-token-cap');
      await prisma.pushToken.deleteMany({ where: { userId: 'user-token-cap' } });
      const service = createService(false);

      for (let index = 0; index < MAX_PUSH_TOKENS_PER_USER + 2; index += 1) {
        await expect(service.saveToken('user-token-cap', `token-cap-${index}`)).resolves.toBe(true);
      }

      await expect(
        prisma.pushToken.count({ where: { userId: 'user-token-cap' } }),
      ).resolves.toBe(MAX_PUSH_TOKENS_PER_USER);
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
        expect.objectContaining({ successCount: 2, total: 2 })
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
        type: 'new_message',
        url: '/test',
        data: {
          extra: 'value',
          userId: 'user-1',
          email: 'user@test.local',
          role: 'ADMIN',
          token: 'secret-token',
          responseId: 'provider-response-id',
          providerResponseId: 'provider-response-id-2',
        }
      });

      expect(message).toMatchObject({
        token: 'token',
        data: expect.objectContaining({ type: 'new_message', extra: 'value' }),
        webpush: expect.any(Object)
      });
      expect(message.data).not.toHaveProperty('userId');
      expect(message.data).not.toHaveProperty('email');
      expect(message.data).not.toHaveProperty('role');
      expect(message.data).not.toHaveProperty('token');
      expect(message.data).not.toHaveProperty('responseId');
      expect(message.data).not.toHaveProperty('providerResponseId');
      expect(message.webpush?.notification?.data).not.toHaveProperty('userId');
      expect(message.webpush?.notification?.data).not.toHaveProperty('email');
      expect(message.webpush?.notification?.data).not.toHaveProperty('role');
      expect(message.webpush?.notification?.data).not.toHaveProperty('token');
      expect(message.webpush?.notification?.data).not.toHaveProperty('responseId');
      expect(message.webpush?.notification?.data).not.toHaveProperty('providerResponseId');
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
