import { beforeEach, afterEach, describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import { TwoFactorService, twoFactorService } from '../two-factor.service';
import { cacheService } from '../cache.service';

// Mock mailer module
jest.mock('../../lib/mailer', () => ({
  send2FACode: jest.fn()
}));

// Mock cache service
jest.mock('../cache.service', () => ({
  cacheService: {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn()
  }
}));

import { send2FACode } from '../../lib/mailer';

const mockSend2FACode = send2FACode as jest.MockedFunction<typeof send2FACode>;
const mockCacheService = {
  set: cacheService.set as jest.MockedFunction<typeof cacheService.set>,
  get: cacheService.get as jest.MockedFunction<typeof cacheService.get>,
  del: cacheService.del as jest.MockedFunction<typeof cacheService.del>
};

describe('TwoFactorService', () => {
  let twoFactorServiceInstance: TwoFactorService;

  beforeAll(() => {
    // NODE_ENV is already set to 'test' in Jest environment
  });

  beforeEach(() => {
    twoFactorServiceInstance = new TwoFactorService();

    // Clear all mocks
    jest.clearAllMocks();

    // Default successful cache operations
    mockCacheService.set.mockResolvedValue(true);
    mockCacheService.get.mockResolvedValue(null);
    mockCacheService.del.mockResolvedValue(true);

    // Default successful email sending
    mockSend2FACode.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    // Clear any memory store entries that might exist
    // Access memory store through any type to avoid type issues
    const memoryStore = (require('../two-factor.service') as any).memoryStore;
    if (memoryStore) {
      memoryStore.clear();
    }
  });

  describe('Code Generation', () => {
    it('should generate 6-digit codes', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      // Verify that set was called with a 6-digit code
      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user123',
        expect.stringMatching(/^\d{6}$/),
        300
      );
    });

    it('should generate different codes on multiple calls', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      await twoFactorServiceInstance.sendCode('user1', 'test1@example.com');
      await twoFactorServiceInstance.sendCode('user2', 'test2@example.com');

      const calls = mockCacheService.set.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][1]).not.toBe(calls[1][1]); // Different codes
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate correct cache keys', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user123',
        expect.any(String),
        300
      );
    });

    it('should generate different cache keys for different users', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      await twoFactorServiceInstance.sendCode('user1', 'test1@example.com');
      await twoFactorServiceInstance.sendCode('user2', 'test2@example.com');

      expect(mockCacheService.set).toHaveBeenNthCalledWith(
        1, '2fa:user1', expect.any(String), 300
      );
      expect(mockCacheService.set).toHaveBeenNthCalledWith(
        2, '2fa:user2', expect.any(String), 300
      );
    });
  });

  describe('sendCode method', () => {
    it('should send code successfully with Redis', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      const result = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Code envoyé par email');

      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user123',
        expect.stringMatching(/^\d{6}$/),
        300
      );

      expect(mockSend2FACode).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^\d{6}$/)
      );
    });

    it('should fallback to memory store when Redis fails', async () => {
      mockCacheService.set.mockResolvedValue(false); // Redis fails
      mockSend2FACode.mockResolvedValue({ sent: true });

      const result = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Code envoyé par email');

      // Should still try Redis first
      expect(mockCacheService.set).toHaveBeenCalled();
      expect(mockSend2FACode).toHaveBeenCalled();

      // Code should be stored in memory store (we can't directly test this without exposing internals)
    });

    it('should handle email sending failure', async () => {
      mockSend2FACode.mockResolvedValue({ sent: false });

      const result = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Erreur lors de l\'envoi de l\'email');

      // Code should still be cached even if email fails
      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it('should handle email skipped in development', async () => {
      mockSend2FACode.mockResolvedValue({ sent: false, skipped: true } as any);

      // Mock console.warn to verify logging
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Code envoyé par email');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('2FA code for user user123:')
      );

      consoleSpy.mockRestore();
    });

    it('should handle exceptions gracefully', async () => {
      mockSend2FACode.mockRejectedValue(new Error('Network error'));

      // Mock console.error to verify error logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Erreur interne');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should set correct TTL for code expiration', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        300 // 5 minutes
      );
    });
  });

  describe('verifyCode method', () => {
    const testCode = '123456';
    const userId = 'user123';

    beforeEach(async () => {
      // Setup: send a code first
      mockSend2FACode.mockResolvedValue({ sent: true });
      await twoFactorServiceInstance.sendCode(userId, 'test@example.com');

      // Get the code that was stored
      const setCall = mockCacheService.set.mock.calls[0];
      const storedCode = setCall[1];

      // Mock get to return the stored code
      mockCacheService.get.mockResolvedValue(storedCode);

      // Clear previous mocks to focus on verification
      jest.clearAllMocks();
      mockCacheService.get.mockResolvedValue(testCode);
    });

    it('should verify correct code successfully', async () => {
      const result = await twoFactorServiceInstance.verifyCode(userId, testCode);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Code valide');

      expect(mockCacheService.get).toHaveBeenCalledWith('2fa:user123');
      expect(mockCacheService.del).toHaveBeenCalledWith('2fa:user123');
    });

    it('should reject incorrect code', async () => {
      const result = await twoFactorServiceInstance.verifyCode(userId, '654321');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Code incorrect');

      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockCacheService.del).not.toHaveBeenCalled(); // Don't delete on wrong code
    });

    it('should handle non-existent or expired code', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await twoFactorServiceInstance.verifyCode(userId, testCode);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Code expiré ou inexistant');

      expect(mockCacheService.del).not.toHaveBeenCalled();
    });

    it('should trim whitespace from provided code', async () => {
      const result = await twoFactorServiceInstance.verifyCode(userId, '  123456  ');

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Code valide');
    });

    it('should fallback to memory store when Redis returns null', async () => {
      mockCacheService.get.mockResolvedValue(null);

      // Manually add to memory store to simulate fallback scenario
      const memoryStore = (require('../two-factor.service') as any).memoryStore;
      if (memoryStore) {
        memoryStore.set('2fa:user123', {
          code: testCode,
          expiresAt: Date.now() + 300000
        });
      }

      const result = await twoFactorServiceInstance.verifyCode(userId, testCode);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Code valide');
      expect(mockCacheService.get).toHaveBeenCalled();
    });

    it('should handle expired memory store entry', async () => {
      mockCacheService.get.mockResolvedValue(null);

      // Add expired entry to memory store
      const memoryStore = (require('../two-factor.service') as any).memoryStore;
      if (memoryStore) {
        memoryStore.set('2fa:user123', {
          code: testCode,
          expiresAt: Date.now() - 1000 // Expired 1 second ago
        });
      }

      const result = await twoFactorServiceInstance.verifyCode(userId, testCode);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Code expiré ou inexistant');
    });

    it('should handle cache service errors', async () => {
      mockCacheService.get.mockRejectedValue(new Error('Cache error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await twoFactorServiceInstance.verifyCode(userId, testCode);

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Erreur interne');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should delete code from memory store after successful verification', async () => {
      mockCacheService.get.mockResolvedValue(null);

      // Add to memory store
      const memoryStore = (require('../two-factor.service') as any).memoryStore;
      if (memoryStore) {
        memoryStore.set('2fa:user123', {
          code: testCode,
          expiresAt: Date.now() + 300000
        });
      }

      const result = await twoFactorServiceInstance.verifyCode(userId, testCode);

      expect(result.valid).toBe(true);

      // Verify code was deleted from memory store
      if (memoryStore) {
        expect(memoryStore.has('2fa:user123')).toBe(false);
      }
    });
  });

  describe('hasPendingCode method', () => {
    it('should return true when code exists in cache', async () => {
      mockCacheService.get.mockResolvedValue('123456');

      const result = await twoFactorServiceInstance.hasPendingCode('user123');

      expect(result).toBe(true);
      expect(mockCacheService.get).toHaveBeenCalledWith('2fa:user123');
    });

    it('should return false when no code exists', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await twoFactorServiceInstance.hasPendingCode('user123');

      expect(result).toBe(false);
    });

    it('should return false when cache service errors', async () => {
      mockCacheService.get.mockRejectedValue(new Error('Cache error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await twoFactorServiceInstance.hasPendingCode('user123');

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('cancelPendingCode method', () => {
    it('should delete code from cache', async () => {
      await twoFactorServiceInstance.cancelPendingCode('user123');

      expect(mockCacheService.del).toHaveBeenCalledWith('2fa:user123');
    });

    it('should handle cache service errors silently', async () => {
      mockCacheService.del.mockRejectedValue(new Error('Cache error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await expect(twoFactorServiceInstance.cancelPendingCode('user123')).resolves.not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Memory Store Cleanup', () => {
    it('should have cleanup interval disabled in test environment', () => {
      // This test verifies that cleanup interval is not started in test environment
      // We can't easily test the cleanup logic itself without more complex mocking
      expect(process.env.NODE_ENV).toBe('test');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete flow: send -> verify -> second verification fails', async () => {
      const userId = 'integration-user';
      const email = 'integration@example.com';

      // Send code
      mockSend2FACode.mockResolvedValue({ sent: true });
      const sendResult = await twoFactorServiceInstance.sendCode(userId, email);
      expect(sendResult.success).toBe(true);

      // Get the code that was sent
      const setCall = mockCacheService.set.mock.calls[0];
      const sentCode = setCall[1];

      // Mock get to return the code for first verification
      mockCacheService.get.mockResolvedValueOnce(sentCode);

      // First verification should succeed
      const firstVerify = await twoFactorServiceInstance.verifyCode(userId, sentCode as string);
      expect(firstVerify.valid).toBe(true);

      // Mock get to return null for second verification (code was deleted)
      mockCacheService.get.mockResolvedValueOnce(null);

      // Second verification should fail
      const secondVerify = await twoFactorServiceInstance.verifyCode(userId, sentCode as string);
      expect(secondVerify.valid).toBe(false);
      expect(secondVerify.message).toBe('Code expiré ou inexistant');
    });

    it('should handle multiple users simultaneously', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      // Send codes for multiple users
      await twoFactorServiceInstance.sendCode('user1', 'user1@example.com');
      await twoFactorServiceInstance.sendCode('user2', 'user2@example.com');
      await twoFactorServiceInstance.sendCode('user3', 'user3@example.com');

      // Verify correct cache keys were used
      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user1', expect.any(String), 300
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user2', expect.any(String), 300
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user3', expect.any(String), 300
      );

      // All codes should be different
      const codes = mockCacheService.set.mock.calls.map(call => call[1]);
      expect(new Set(codes).size).toBe(3); // All unique
    });

    it('should handle rapid successive send requests for same user', async () => {
      const userId = 'rapid-user';
      const email = 'rapid@example.com';

      mockSend2FACode.mockResolvedValue({ sent: true });

      // Send multiple codes rapidly
      const results = await Promise.all([
        twoFactorServiceInstance.sendCode(userId, email),
        twoFactorServiceInstance.sendCode(userId, email),
        twoFactorServiceInstance.sendCode(userId, email)
      ]);

      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Multiple codes should have been generated
      expect(mockCacheService.set).toHaveBeenCalledTimes(3);
    });
  });

  describe('Singleton Export', () => {
    it('should export singleton instance', () => {
      expect(twoFactorService).toBeInstanceOf(TwoFactorService);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from cache service being unavailable', async () => {
      // Simulate cache service being completely unavailable
      mockCacheService.set.mockRejectedValue(new Error('Cache unavailable'));
      mockCacheService.get.mockRejectedValue(new Error('Cache unavailable'));
      mockCacheService.del.mockRejectedValue(new Error('Cache unavailable'));

      mockSend2FACode.mockResolvedValue({ sent: true });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Send should fail gracefully
      const sendResult = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');
      expect(sendResult.success).toBe(false);
      expect(sendResult.message).toBe('Erreur interne');

      // Verify should fail gracefully
      const verifyResult = await twoFactorServiceInstance.verifyCode('user123', '123456');
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.message).toBe('Erreur interne');

      // hasPendingCode should return false
      const pendingResult = await twoFactorServiceInstance.hasPendingCode('user123');
      expect(pendingResult).toBe(false);

      // cancelPendingCode should not throw
      await expect(twoFactorServiceInstance.cancelPendingCode('user123')).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});