import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { CacheService } from '../cache.service';
import { secureLogger } from '../../utils/secure-logger';

const redisMock = (globalThis as any).__REDIS_MOCK__ as {
  factory: () => any;
};

describe('CacheService — 2FA raw storage hardening', () => {
  let cacheServiceInstance: CacheService;
  let mockRedisClient: ReturnType<typeof redisMock.factory>;
  let errorSpy: jest.SpiedFunction<typeof secureLogger.error>;

  beforeEach(async () => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(secureLogger, 'error').mockImplementation(() => undefined);

    cacheServiceInstance = CacheService.getInstance();
    await cacheServiceInstance.close();

    mockRedisClient = redisMock.factory();
    (cacheServiceInstance as any).client = mockRedisClient;
  });

  afterEach(async () => {
    await cacheServiceInstance.close();
    (cacheServiceInstance as any).client = null;
    errorSpy.mockRestore();
  });

  it('stocke le hash 2FA brut avec TTL sans JSON.stringify', async () => {
    const codeHash = 'a'.repeat(64);

    const result = await cacheServiceInstance.setTwoFactorCodeHash('user123', codeHash, 300);

    expect(result).toEqual({ ok: true });
    expect(mockRedisClient.setEx).toHaveBeenCalledWith('2fa:user123', 300, codeHash);
    expect(mockRedisClient.setEx.mock.calls[0][2]).not.toBe(JSON.stringify(codeHash));
  });

  it("refuse de stocker un OTP en clair à la place d'un hash", async () => {
    const result = await cacheServiceInstance.setTwoFactorCodeHash('user123', '123456', 300);

    expect(result).toEqual({ ok: false, reason: 'invalid_value' });
    expect(mockRedisClient.setEx).not.toHaveBeenCalled();
  });

  it('renvoie le hash brut sans parsing JSON', async () => {
    const codeHash = 'b'.repeat(64);
    mockRedisClient.get.mockResolvedValue(codeHash);

    const result = await cacheServiceInstance.getTwoFactorCodeHash('user123');

    expect(result).toEqual({ ok: true, found: true, value: codeHash });
  });

  it("distingue explicitement une absence de clé d'une erreur Redis", async () => {
    mockRedisClient.get.mockResolvedValueOnce(null);

    const miss = await cacheServiceInstance.getTwoFactorCodeHash('user123');

    expect(miss).toEqual({ ok: true, found: false });

    mockRedisClient.get.mockRejectedValueOnce(
      new Error('read failed for 2fa:user123 via redis://alice:super-secret@localhost:6379'),
    );

    const failure = await cacheServiceInstance.getTwoFactorCodeHash('user123');

    expect(failure).toEqual({ ok: false, reason: 'read_error' });
    expect(errorSpy).toHaveBeenCalledWith(
      'CACHE_2FA_RAW_READ_FAILED',
      expect.objectContaining({
        cacheNamespace: '2fa',
        errorType: 'Error',
      }),
    );

    const loggedContext = errorSpy.mock.calls.at(-1)?.[1];
    expect(JSON.stringify(loggedContext)).not.toContain('2fa:user123');
    expect(JSON.stringify(loggedContext)).not.toContain('super-secret');
  });

  it('refuse les identifiants non autorisés pour le namespace 2fa', async () => {
    const writeResult = await cacheServiceInstance.setTwoFactorCodeHash('user:123', 'c'.repeat(64), 300);
    const readResult = await cacheServiceInstance.getTwoFactorCodeHash('user:123');

    expect(writeResult).toEqual({ ok: false, reason: 'invalid_identifier' });
    expect(readResult).toEqual({ ok: false, reason: 'invalid_identifier' });
    expect(mockRedisClient.setEx).not.toHaveBeenCalled();
    expect(mockRedisClient.get).not.toHaveBeenCalled();
  });
});
