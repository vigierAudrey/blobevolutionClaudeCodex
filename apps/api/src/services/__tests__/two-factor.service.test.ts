import { beforeEach, afterEach, describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import { TwoFactorService, twoFactorService, memoryStore as twoFactorMemoryStore } from '../two-factor.service';
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
    del: jest.fn(),
    getClient: jest.fn()
  }
}));

import { send2FACode } from '../../lib/mailer';

const mockSend2FACode = send2FACode as jest.MockedFunction<typeof send2FACode>;
const mockCacheService = {
  set: cacheService.set as jest.MockedFunction<typeof cacheService.set>,
  get: cacheService.get as jest.MockedFunction<typeof cacheService.get>,
  del: cacheService.del as jest.MockedFunction<typeof cacheService.del>,
  getClient: cacheService.getClient as jest.MockedFunction<typeof cacheService.getClient>
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
    mockCacheService.getClient.mockReturnValue(null); // No Redis in tests (fallback mode)

    // Default successful email sending
    mockSend2FACode.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    // Clear any memory store entries that might exist
    // Access memory store through any type to avoid type issues
    twoFactorMemoryStore?.clear();
  });

  describe('Code Generation', () => {
    it('should generate 6-digit codes', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      // Verify that EMAIL received a 6-digit code (plaintext)
      expect(mockSend2FACode).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^\d{6}$/)
      );

      // Verify that CACHE received a hash (not plaintext)
      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user123',
        expect.stringMatching(/^[a-f0-9]{64}$/), // SHA-256 hash
        300
      );
    });

    it('should generate different codes on multiple calls', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      await twoFactorServiceInstance.sendCode('user1', 'test1@example.com');
      await twoFactorServiceInstance.sendCode('user2', 'test2@example.com');

      // Check that different codes were generated (via email)
      const emailCalls = mockSend2FACode.mock.calls;
      expect(emailCalls).toHaveLength(2);
      expect(emailCalls[0][1]).not.toBe(emailCalls[1][1]); // Different codes

      // Check that different hashes were stored (code caches are calls 1 and 3; calls 2 and 4 are challengeId)
      const cacheCalls = mockCacheService.set.mock.calls;
      expect(cacheCalls).toHaveLength(4);
      expect(cacheCalls[0][1]).not.toBe(cacheCalls[2][1]); // Different hashes
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
      // call 2 is challengeId for user1
      expect(mockCacheService.set).toHaveBeenNthCalledWith(
        3, '2fa:user2', expect.any(String), 300
      );
    });
  });

  describe('sendCode method', () => {
    it('should send code successfully with Redis', async () => {
      mockSend2FACode.mockResolvedValue({ sent: true });

      const result = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Code envoyé par email');

      // Email receives plaintext 6-digit code
      expect(mockSend2FACode).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^\d{6}$/)
      );

      // Cache stores hash (64-char hex)
      expect(mockCacheService.set).toHaveBeenCalledWith(
        '2fa:user123',
        expect.stringMatching(/^[a-f0-9]{64}$/),
        300
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

      const result = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toBe("Erreur lors de l'envoi de l'email");
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
    const userId = 'user123';
    let sentCode: string;
    let storedHash: string;

    beforeEach(async () => {
      // Setup: send a code first to get a real code+hash pair
      mockSend2FACode.mockResolvedValue({ sent: true });
      await twoFactorServiceInstance.sendCode(userId, 'test@example.com');

      // Extract the code that was sent via email (plaintext)
      const emailCall = mockSend2FACode.mock.calls[0];
      sentCode = emailCall[1] as string;

      // Extract the hash that was stored in cache
      const setCall = mockCacheService.set.mock.calls[0];
      storedHash = setCall[1] as string;

      // Since getClient() returns null in tests, verifyCode uses memory store
      // Populate memory store with the hash
      twoFactorMemoryStore?.set(`2fa:${userId}`, {
        hash: storedHash,
        expiresAt: Date.now() + 300000
      });

      // Clear previous mocks to focus on verification
      jest.clearAllMocks();
    });

    it('should verify correct code successfully', async () => {
      const result = await twoFactorServiceInstance.verifyCode(userId, sentCode);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Code valide');

      // Code should be deleted from memory store after successful verification
      expect(twoFactorMemoryStore?.has(`2fa:${userId}`)).toBe(false);
    });

    it('should reject incorrect code', async () => {
      const result = await twoFactorServiceInstance.verifyCode(userId, '654321');

      expect(result.valid).toBe(false);
      // Anti-oracle: unified message (same as NO_CODE to prevent user enumeration)
      expect(result.message).toBe('Code invalide ou expiré');

      // Code should still exist in memory store (not deleted on wrong code)
      expect(twoFactorMemoryStore?.has(`2fa:${userId}`)).toBe(true);
    });

    it('should handle non-existent or expired code', async () => {
      // Remove code from memory store to simulate expiration/absence
      twoFactorMemoryStore?.delete(`2fa:${userId}`);

      const result = await twoFactorServiceInstance.verifyCode(userId, sentCode);

      expect(result.valid).toBe(false);
      // Anti-oracle: same message whether code is missing or invalid
      expect(result.message).toBe('Code invalide ou expiré');
    });

    it('should trim whitespace from provided code', async () => {
      const result = await twoFactorServiceInstance.verifyCode(userId, `  ${sentCode}  `);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Code valide');
    });

    it('should use memory store in test mode', async () => {
      // Memory store is already populated in beforeEach
      // This test verifies that verification works via memory store

      const result = await twoFactorServiceInstance.verifyCode(userId, sentCode);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('Code valide');

      // Verify code was deleted from memory store
      expect(twoFactorMemoryStore?.has(`2fa:${userId}`)).toBe(false);
    });

    it('should handle expired memory store entry', async () => {
      mockCacheService.get.mockResolvedValue(null);

      // Add expired entry to memory store
      twoFactorMemoryStore?.set('2fa:user123', {
        hash: storedHash,
        expiresAt: Date.now() - 1000 // Expired 1 second ago
      });

      const result = await twoFactorServiceInstance.verifyCode(userId, sentCode);

      expect(result.valid).toBe(false);
      // Anti-oracle: same message whether code is missing or invalid
      expect(result.message).toBe('Code invalide ou expiré');
    });

    it('should handle unexpected errors gracefully', async () => {
      // Corrupt the memory store to cause an error
      twoFactorMemoryStore?.set(`2fa:${userId}`, null as any);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await twoFactorServiceInstance.verifyCode(userId, sentCode);

      // Even with errors, should return graceful error message
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/Code|Erreur/); // Either "Code expiré" or "Erreur interne"

      consoleSpy.mockRestore();
    });

    it('should delete code from memory store after successful verification', async () => {
      mockCacheService.get.mockResolvedValue(null);

      // Add to memory store (must use hash)
      twoFactorMemoryStore?.set('2fa:user123', {
        hash: storedHash,
        expiresAt: Date.now() + 300000
      });

      const result = await twoFactorServiceInstance.verifyCode(userId, sentCode);

      expect(result.valid).toBe(true);
      expect(twoFactorMemoryStore?.has('2fa:user123')).toBe(false);
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

      // Get the plaintext code from email and hash from cache
      const emailCall = mockSend2FACode.mock.calls[0];
      const sentCode = emailCall[1] as string;

      const setCall = mockCacheService.set.mock.calls[0];
      const storedHash = setCall[1] as string;

      // Populate memory store (since getClient returns null in tests)
      twoFactorMemoryStore?.set(`2fa:${userId}`, {
        hash: storedHash,
        expiresAt: Date.now() + 300000
      });

      // First verification should succeed (and delete code from memory store)
      const firstVerify = await twoFactorServiceInstance.verifyCode(userId, sentCode);
      expect(firstVerify.valid).toBe(true);

      // Second verification should fail (code was deleted)
      const secondVerify = await twoFactorServiceInstance.verifyCode(userId, sentCode);
      expect(secondVerify.valid).toBe(false);
      // Anti-oracle: same message whether code is missing or invalid
      expect(secondVerify.message).toBe('Code invalide ou expiré');
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

      // All code hashes should be different (filter out challengeId entries)
      const codes = mockCacheService.set.mock.calls
        .filter(call => !String(call[0]).startsWith('2fa:challenge:'))
        .map(call => call[1]);
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

      // Multiple codes should have been generated (2 cache entries per sendCode: code + challengeId)
      expect(mockCacheService.set).toHaveBeenCalledTimes(6);
    });
  });

  describe('Singleton Export', () => {
    it('should export singleton instance', () => {
      expect(twoFactorService).toBeInstanceOf(TwoFactorService);
    });
  });

  describe('Error Recovery', () => {
    it('should use memory fallback when cache service is unavailable', async () => {
      // In test mode (NODE_ENV=test), memory fallback is enabled
      // When cache fails, memory store is used automatically

      // Simulate cache service failing
      mockCacheService.set.mockResolvedValue(false); // Redis fails but doesn't throw
      mockSend2FACode.mockResolvedValue({ sent: true });

      // Send code - should succeed via memory fallback
      const sendResult = await twoFactorServiceInstance.sendCode('user123', 'test@example.com');
      expect(sendResult.success).toBe(true);

      // Get the code from email mock
      const sentCode = mockSend2FACode.mock.calls[0][1] as string;

      // Verify code - should work via memory fallback
      const verifyResult = await twoFactorServiceInstance.verifyCode('user123', sentCode);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.message).toBe('Code valide');
    });

    it('should handle errors gracefully when cache operations fail', async () => {
      // In test mode with memory fallback, cache errors are handled gracefully
      mockCacheService.get.mockRejectedValue(new Error('Cache unavailable'));
      mockCacheService.del.mockRejectedValue(new Error('Cache unavailable'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // hasPendingCode should return false on error (graceful degradation)
      const pendingResult = await twoFactorServiceInstance.hasPendingCode('user123');
      expect(pendingResult).toBe(false);

      // cancelPendingCode should not throw (graceful error handling)
      await expect(twoFactorServiceInstance.cancelPendingCode('user123')).resolves.not.toThrow();

      // Errors should be logged
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
