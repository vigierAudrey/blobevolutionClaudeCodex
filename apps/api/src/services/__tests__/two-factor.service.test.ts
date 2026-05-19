import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TwoFactorService, memoryStore as twoFactorMemoryStore } from '../two-factor.service';
import { cacheService } from '../cache.service';

jest.mock('../../lib/mailer', () => ({
  send2FACode: jest.fn(),
}));

jest.mock('../cache.service', () => ({
  cacheService: {
    set: jest.fn(),
    get: jest.fn(),
    setTwoFactorCodeHash: jest.fn(),
    getTwoFactorCodeHash: jest.fn(),
    del: jest.fn(),
    getClient: jest.fn(),
  },
}));

jest.mock('../../utils/secure-logger', () => ({
  secureLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    security: jest.fn(),
  },
}));

import { send2FACode } from '../../lib/mailer';
import { secureLogger } from '../../utils/secure-logger';

const mockSend2FACode = send2FACode as jest.MockedFunction<typeof send2FACode>;
const mockCacheService = {
  set: cacheService.set as jest.MockedFunction<typeof cacheService.set>,
  setTwoFactorCodeHash: cacheService.setTwoFactorCodeHash as unknown as jest.MockedFunction<any>,
  getTwoFactorCodeHash: cacheService.getTwoFactorCodeHash as unknown as jest.MockedFunction<any>,
  del: cacheService.del as jest.MockedFunction<typeof cacheService.del>,
  getClient: cacheService.getClient as jest.MockedFunction<typeof cacheService.getClient>,
};
const mockSecureLogger = secureLogger as {
  [K in keyof typeof secureLogger]: jest.MockedFunction<typeof secureLogger[K]>;
};

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  beforeEach(() => {
    service = new TwoFactorService();
    jest.clearAllMocks();

    mockCacheService.set.mockResolvedValue(true);
    mockCacheService.setTwoFactorCodeHash.mockResolvedValue({ ok: true });
    mockCacheService.getTwoFactorCodeHash.mockResolvedValue({ ok: true, found: false });
    mockCacheService.del.mockResolvedValue(true);
    mockCacheService.getClient.mockReturnValue(null);
    mockSend2FACode.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    twoFactorMemoryStore?.clear();
  });

  it('sends a plaintext OTP by email but stores only a hash in cache', async () => {
    const result = await service.sendCode('user123', 'test@example.com');

    expect(result.success).toBe(true);
    const sentCode = mockSend2FACode.mock.calls[0][1] as string;
    const storedHash = mockCacheService.setTwoFactorCodeHash.mock.calls[0][1] as string;

    expect(sentCode).toMatch(/^\d{6}$/);
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedHash).not.toBe(sentCode);
    expect(mockCacheService.setTwoFactorCodeHash).toHaveBeenCalledWith('user123', storedHash, 300);
  });

  it('uses the memory fallback only when the cache client is unavailable', async () => {
    mockCacheService.setTwoFactorCodeHash.mockResolvedValue({ ok: false, reason: 'client_unavailable' });

    const result = await service.sendCode('user123', 'test@example.com');

    expect(result.success).toBe(true);
    expect(twoFactorMemoryStore?.has('2fa:user123')).toBe(true);
    expect(mockSecureLogger.warn).toHaveBeenCalledWith(
      'TWO_FACTOR_MEMORY_FALLBACK_USED',
      expect.objectContaining({ cacheNamespace: '2fa', reason: 'client_unavailable' }),
    );
  });

  it('fails closed when the cache write returns a real error', async () => {
    mockCacheService.setTwoFactorCodeHash.mockResolvedValue({ ok: false, reason: 'write_error' });

    const result = await service.sendCode('user123', 'test@example.com');

    expect(result).toEqual({
      success: false,
      message: 'Service 2FA indisponible (cache)',
    });
    expect(twoFactorMemoryStore?.has('2fa:user123')).toBe(false);
  });

  it("invalidates the previous code when a new code is sent for the same user", async () => {
    mockCacheService.setTwoFactorCodeHash.mockResolvedValue({ ok: false, reason: 'client_unavailable' });

    await service.sendCode('user123', 'test@example.com');
    const firstCode = mockSend2FACode.mock.calls[0][1] as string;

    await service.sendCode('user123', 'test@example.com');
    const secondCode = mockSend2FACode.mock.calls[1][1] as string;

    expect(firstCode).not.toBe(secondCode);
    await expect(service.verifyCode('user123', firstCode)).resolves.toEqual({
      valid: false,
      message: 'Code invalide ou expiré',
    });
    await expect(service.verifyCode('user123', secondCode)).resolves.toEqual({
      valid: true,
      message: 'Code valide',
    });
  });

  it('consumes a valid code exactly once', async () => {
    mockCacheService.setTwoFactorCodeHash.mockResolvedValue({ ok: false, reason: 'client_unavailable' });

    await service.sendCode('user123', 'test@example.com');
    const sentCode = mockSend2FACode.mock.calls[0][1] as string;

    await expect(service.verifyCode('user123', sentCode)).resolves.toEqual({
      valid: true,
      message: 'Code valide',
    });
    await expect(service.verifyCode('user123', sentCode)).resolves.toEqual({
      valid: false,
      message: 'Code invalide ou expiré',
    });
  });

  it('fails closed on cache read errors when no memory fallback exists', async () => {
    mockCacheService.getTwoFactorCodeHash.mockResolvedValue({ ok: false, reason: 'read_error' });

    const result = await service.verifyCode('user123', '123456');

    expect(result).toEqual({
      valid: false,
      message: 'Code invalide ou expiré',
    });
    expect(mockSecureLogger.warn).toHaveBeenCalledWith(
      'TWO_FACTOR_CACHE_READ_UNAVAILABLE',
      expect.objectContaining({ cacheNamespace: '2fa', reason: 'read_error' }),
    );
  });
});
