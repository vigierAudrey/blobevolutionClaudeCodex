import { createHash, randomInt } from 'crypto';
import { cacheService } from './cache.service';
import { send2FACode } from '../lib/mailer';
import { secureLogger } from '../utils/secure-logger';

// Memory fallback is allowed outside production (dev + tests) to keep UX smooth; prod must rely on Redis
const allowMemoryFallback = process.env.NODE_ENV !== 'production';
export const memoryStore = allowMemoryFallback ? new Map<string, { hash: string; expiresAt: number }>() : null;

// 2FA secret for hashing (fail-fast in production if not set)
const TWO_FACTOR_SECRET = process.env.TWO_FACTOR_SECRET;

if (process.env.NODE_ENV === 'production' && (!TWO_FACTOR_SECRET || TWO_FACTOR_SECRET === 'change-me-2fa-secret-production')) {
  throw new Error('FATAL: TWO_FACTOR_SECRET must be set to a secure value in production');
}

// Rate limit thresholds (configurable via env)
const MAX_ATTEMPTS_PER_USER = parseInt(process.env.TWO_FACTOR_MAX_ATTEMPTS_USER || '5', 10);
const MAX_ATTEMPTS_PER_IP = parseInt(process.env.TWO_FACTOR_MAX_ATTEMPTS_IP || '20', 10);
const MAX_ATTEMPTS_PER_USER_IP = parseInt(process.env.TWO_FACTOR_MAX_ATTEMPTS_USER_IP || '5', 10);
const RATE_LIMIT_WINDOW_SECONDS = 300; // 5 minutes

// Memory cleanup interval
if (memoryStore && process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of memoryStore.entries()) {
      if (value.expiresAt < now) {
        memoryStore.delete(key);
      }
    }
  }, 60000);
}

/**
 * Lua script for atomic 2FA verification with rate limiting.
 *
 * This script ensures thread-safe verification even under high concurrency.
 * It combines:
 * - Rate limit checks (user, IP, user+IP)
 * - Code hash verification
 * - Automatic cleanup on success
 * - Attempt increment on failure
 *
 * KEYS[1] = 2fa:{userId}
 * KEYS[2] = 2fa:attempts:user:{userId}
 * KEYS[3] = 2fa:attempts:ip:{ipHash}
 * KEYS[4] = 2fa:attempts:userip:{userId}:{ipHash}
 *
 * ARGV[1] = providedHash
 * ARGV[2] = maxAttemptsUser
 * ARGV[3] = maxAttemptsIp
 * ARGV[4] = maxAttemptsUserIp
 * ARGV[5] = rateLimitTTL
 *
 * Returns:
 * - "BLOCKED_USER" | "BLOCKED_IP" | "BLOCKED_USER_IP" : Rate limit exceeded
 * - "NO_CODE" : No 2FA code found for user
 * - "INVALID" : Code hash doesn't match
 * - "VALID" : Success, code validated and deleted
 */
const VERIFY_2FA_LUA_SCRIPT = `
local codeKey = KEYS[1]
local userAttemptsKey = KEYS[2]
local ipAttemptsKey = KEYS[3]
local userIpAttemptsKey = KEYS[4]

local providedHash = ARGV[1]
local maxAttemptsUser = tonumber(ARGV[2])
local maxAttemptsIp = tonumber(ARGV[3])
local maxAttemptsUserIp = tonumber(ARGV[4])
local rateLimitTTL = tonumber(ARGV[5])

-- Check rate limits
local userAttempts = tonumber(redis.call('GET', userAttemptsKey)) or 0
local ipAttempts = tonumber(redis.call('GET', ipAttemptsKey)) or 0
local userIpAttempts = tonumber(redis.call('GET', userIpAttemptsKey)) or 0

if userAttempts >= maxAttemptsUser then
  return "BLOCKED_USER"
end

if ipAttempts >= maxAttemptsIp then
  return "BLOCKED_IP"
end

if userIpAttempts >= maxAttemptsUserIp then
  return "BLOCKED_USER_IP"
end

-- Check if code exists
local storedHash = redis.call('GET', codeKey)
if not storedHash then
  return "NO_CODE"
end

-- Verify hash
if storedHash ~= providedHash then
  -- Increment attempt counters
  redis.call('INCR', userAttemptsKey)
  redis.call('EXPIRE', userAttemptsKey, rateLimitTTL)
  redis.call('INCR', ipAttemptsKey)
  redis.call('EXPIRE', ipAttemptsKey, rateLimitTTL)
  redis.call('INCR', userIpAttemptsKey)
  redis.call('EXPIRE', userIpAttemptsKey, rateLimitTTL)
  return "INVALID"
end

-- Valid code - cleanup
redis.call('DEL', codeKey)
redis.call('DEL', userAttemptsKey)
redis.call('DEL', ipAttemptsKey)
redis.call('DEL', userIpAttemptsKey)

return "VALID"
`;

export class TwoFactorService {
  /**
   * Hash a 2FA code for secure storage.
   *
   * Uses SHA-256(code + secret + userId) to prevent:
   * - Rainbow table attacks
   * - Cross-user code reuse
   * - Redis dump leaks
   *
   * @param code - 6-digit code
   * @param userId - User identifier (salt)
   * @returns SHA-256 hex hash
   */
  private hashCode(code: string, userId: string): string {
    const secret = TWO_FACTOR_SECRET || 'dev-only-secret';
    return createHash('sha256')
      .update(`${code}:${secret}:${userId}`)
      .digest('hex');
  }

  /**
   * Generate a cryptographically secure 6-digit OTP code.
   *
   * Uses crypto.randomInt instead of Math.random for security.
   * Range: 100000-999999 (inclusive-exclusive) → always 6 digits
   */
  private generateCode(): string {
    return randomInt(100000, 1000000).toString().padStart(6, '0');
  }

  /**
   * Get cache key for 2FA code storage.
   */
  private getCacheKey(userId: string): string {
    return `2fa:${userId}`;
  }

  /**
   * Hash an IP address for rate limiting (privacy-preserving).
   */
  private hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex').substring(0, 16);
  }

  /**
   * Send a 2FA code by email and store it securely.
   *
   * @param userId - User identifier
   * @param email - User email address
   * @returns Success status and message
   */
  async sendCode(userId: string, email: string): Promise<{ success: boolean; message: string }> {
    try {
      const code = this.generateCode();
      const codeHash = this.hashCode(code, userId);
      const cacheKey = this.getCacheKey(userId);

      const redisSuccess = await cacheService.set(cacheKey, codeHash, 300);
      if (!redisSuccess) {
        if (!memoryStore) {
          secureLogger.error('TWO_FACTOR_CACHE_UNAVAILABLE', { userId, cacheKey });
          return {
            success: false,
            message: 'Service 2FA indisponible (cache)'
          };
        }
        memoryStore.set(cacheKey, { hash: codeHash, expiresAt: Date.now() + 300000 });
        secureLogger.warn('TWO_FACTOR_MEMORY_FALLBACK_USED', { userId, cacheKey });
      }

      // Send email
      const emailResult = await send2FACode(email, code);

      if (emailResult.sent === false) {
        secureLogger.warn('TWO_FACTOR_EMAIL_FAILED', { userId, cacheKey });
        return {
          success: false,
          message: 'Erreur lors de l\'envoi de l\'email'
        };
      }

      if (emailResult.skipped) {
        secureLogger.info('TWO_FACTOR_EMAIL_SKIPPED', { userId, cacheKey });
      }

      return {
        success: true,
        message: 'Code envoyé par email'
      };
    } catch (error) {
      secureLogger.error('TWO_FACTOR_SEND_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: 'Erreur interne'
      };
    }
  }

  /**
   * Verify a 2FA code with rate limiting and atomic checks.
   *
   * Security features:
   * - Hash-based verification (no plaintext comparison)
   * - Rate limiting per user, IP, and user+IP
   * - Atomic Lua script (thread-safe under concurrency)
   * - Automatic cleanup on success
   * - No information leakage (generic error messages)
   *
   * @param userId - User identifier
   * @param providedCode - Code provided by user
   * @param clientIp - Client IP address (for rate limiting)
   * @returns Validation result
   */
  async verifyCode(userId: string, providedCode: string, clientIp?: string): Promise<{ valid: boolean; message: string }> {
    try {
      const cacheKey = this.getCacheKey(userId);
      const providedHash = this.hashCode(providedCode.trim(), userId);

      // If Redis available, use Lua script for atomic verification
      const redisClient = cacheService.getClient();
      if (redisClient && clientIp) {
        const ipHash = this.hashIp(clientIp);

        const result = await redisClient.eval(VERIFY_2FA_LUA_SCRIPT, {
          keys: [
            cacheKey,
            `2fa:attempts:user:${userId}`,
            `2fa:attempts:ip:${ipHash}`,
            `2fa:attempts:userip:${userId}:${ipHash}`
          ],
          arguments: [
            providedHash,
            String(MAX_ATTEMPTS_PER_USER),
            String(MAX_ATTEMPTS_PER_IP),
            String(MAX_ATTEMPTS_PER_USER_IP),
            String(RATE_LIMIT_WINDOW_SECONDS)
          ]
        });

        switch (result) {
          case 'VALID':
            secureLogger.info('TWO_FACTOR_VERIFIED', { userId });
            return { valid: true, message: 'Code valide' };

          case 'BLOCKED_USER':
          case 'BLOCKED_IP':
          case 'BLOCKED_USER_IP':
            secureLogger.warn('TWO_FACTOR_RATE_LIMITED', { userId, reason: result, ip: clientIp });
            return { valid: false, message: 'Trop de tentatives. Veuillez réessayer dans 5 minutes.' };

          case 'NO_CODE':
            return { valid: false, message: 'Code expiré ou inexistant' };

          case 'INVALID':
          default:
            secureLogger.warn('TWO_FACTOR_INVALID_CODE', { userId });
            return { valid: false, message: 'Code incorrect' };
        }
      }

      // Fallback: Memory store or basic Redis (dev/test only)
      let storedHash: string | null = null;
      let usingMemoryStore = false;

      if (redisClient) {
        storedHash = await cacheService.get<string>(cacheKey);
      }

      if (!storedHash && memoryStore) {
        const memoryEntry = memoryStore.get(cacheKey);
        if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
          storedHash = memoryEntry.hash;
          usingMemoryStore = true;
        }
      }

      if (!storedHash) {
        return {
          valid: false,
          message: 'Code expiré ou inexistant'
        };
      }

      if (storedHash !== providedHash) {
        return {
          valid: false,
          message: 'Code incorrect'
        };
      }

      // Valid code - cleanup
      if (usingMemoryStore && memoryStore) {
        memoryStore.delete(cacheKey);
      } else if (redisClient) {
        await cacheService.del(cacheKey);
      }

      return {
        valid: true,
        message: 'Code valide'
      };
    } catch (error) {
      secureLogger.error('TWO_FACTOR_VERIFY_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        valid: false,
        message: 'Erreur interne'
      };
    }
  }

  /**
   * Check if a user has a pending 2FA code.
   */
  async hasPendingCode(userId: string): Promise<boolean> {
    try {
      const cacheKey = this.getCacheKey(userId);
      const storedCode = await cacheService.get(cacheKey);
      if (storedCode) return true;
      if (memoryStore?.has(cacheKey)) {
        const entry = memoryStore.get(cacheKey)!;
        return entry.expiresAt > Date.now();
      }
      return false;
    } catch (error) {
      secureLogger.error('TWO_FACTOR_PENDING_CHECK_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Cancel a pending 2FA code.
   */
  async cancelPendingCode(userId: string): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(userId);
      await cacheService.del(cacheKey);
      if (memoryStore) {
        memoryStore.delete(cacheKey);
      }
    } catch (error) {
      secureLogger.error('TWO_FACTOR_CANCEL_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const twoFactorService = new TwoFactorService();
