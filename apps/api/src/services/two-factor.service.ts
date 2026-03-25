import { createHash, randomInt } from 'crypto';
import { cacheService } from './cache.service';
import { send2FACode } from '../lib/mailer';
import { secureLogger } from '../utils/secure-logger';
import { hashIpHmac } from '../lib/hash-ip';
import { securityEventAlertService } from './security-event-alert.service';

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

// Concurrent challenge flood control (memory fallback — Redis path uses INCR/DECR per userId).
// Exported so tests can reset it between runs via challengeCounter.clear().
const MAX_CONCURRENT_CHALLENGES = parseInt(process.env.TWO_FACTOR_MAX_CONCURRENT_CHALLENGES || '3', 10);
export const challengeCounter = new Map<string, number>();

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

/**
 * SHA hash of the Lua script (populated by loadLuaScript at boot).
 * Using EVALSHA reduces latency by ~30% (no script parsing on every request).
 */
let luaScriptSha: string | null = null;
const TWO_FACTOR_LOG_CONTEXT = { cacheNamespace: '2fa' } as const;

type StoredHashResolution =
  | { status: 'hit'; hash: string; source: 'cache' | 'memory' }
  | { status: 'miss' }
  | { status: 'cache_unavailable'; reason: 'client_unavailable' | 'read_error' | 'invalid_identifier' };

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

  private getValidMemoryEntry(cacheKey: string) {
    if (!memoryStore) return null;

    const entry = memoryStore.get(cacheKey);
    if (!entry) return null;

    if (entry.expiresAt <= Date.now()) {
      memoryStore.delete(cacheKey);
      return null;
    }

    return entry;
  }

  private decrementChallengeCounterMemory(userId: string) {
    const cur = challengeCounter.get(userId) ?? 0;
    if (cur > 1) challengeCounter.set(userId, cur - 1);
    else challengeCounter.delete(userId);
  }

  private async decrementChallengeCounterRedis(userId: string, redisClient: any) {
    const decrVal = await redisClient.decr(`2fa:challenges:${userId}`);
    if (decrVal <= 0) {
      await redisClient.del(`2fa:challenges:${userId}`);
    }
  }

  private async resolveStoredHash(userId: string): Promise<StoredHashResolution> {
    const cacheKey = this.getCacheKey(userId);
    const cacheRead = await cacheService.getTwoFactorCodeHash(userId);

    if (cacheRead.ok && cacheRead.found) {
      return {
        status: 'hit',
        hash: cacheRead.value,
        source: 'cache',
      };
    }

    const memoryEntry = this.getValidMemoryEntry(cacheKey);
    if (memoryEntry) {
      return {
        status: 'hit',
        hash: memoryEntry.hash,
        source: 'memory',
      };
    }

    if (!cacheRead.ok) {
      secureLogger.warn('TWO_FACTOR_CACHE_READ_UNAVAILABLE', {
        ...TWO_FACTOR_LOG_CONTEXT,
        reason: cacheRead.reason,
      });
      return {
        status: 'cache_unavailable',
        reason: cacheRead.reason,
      };
    }

    return { status: 'miss' };
  }

  private async tryVerifyMemoryFallback(userId: string, providedHash: string, redisClient: any | null) {
    const cacheKey = this.getCacheKey(userId);
    const memoryEntry = this.getValidMemoryEntry(cacheKey);
    if (!memoryEntry) {
      return { usedFallback: false, valid: false } as const;
    }

    if (memoryEntry.hash !== providedHash) {
      return { usedFallback: true, valid: false } as const;
    }

    memoryStore?.delete(cacheKey);
    if (redisClient) {
      await this.decrementChallengeCounterRedis(userId, redisClient);
    } else {
      this.decrementChallengeCounterMemory(userId);
    }

    secureLogger.info('TWO_FACTOR_VERIFIED', {
      ...TWO_FACTOR_LOG_CONTEXT,
    });
    return { usedFallback: true, valid: true } as const;
  }

  /**
   * Send a 2FA code by email and store it securely.
   *
   * @param userId - User identifier
   * @param email - User email address
   * @returns Success status and message
   */
  async sendCode(
    userId: string,
    email: string,
  ): Promise<{ success: boolean; message: string; tooManyChallenges?: boolean; challengeId?: string }> {
    try {
      const codeKey = this.getCacheKey(userId);
      const challengeCounterKey = `2fa:challenges:${userId}`;

      // Concurrent challenge flood guard.
      // Redis path (multi-pod safe): INCR/DECR on 2fa:challenges:{userId}.
      // Memory path (dev/test, single-pod): local Map fallback.
      //
      // Stale counter reset: if no active code exists in cache, the counter was never
      // decremented after natural code expiry (300s TTL). Reset it before checking.
      const sendRedisClient = cacheService.getClient();
      let activeCount: number;
      if (sendRedisClient) {
        const activeCodeExists = await sendRedisClient.exists(codeKey);
        if (!activeCodeExists) {
          // No active code → counter is stale (code expired without verify/cancel). Reset.
          await sendRedisClient.del(challengeCounterKey);
        }
        const raw = await sendRedisClient.get(challengeCounterKey);
        const parsed = raw ? parseInt(String(raw), 10) : 0;
        activeCount = Number.isFinite(parsed) ? parsed : 0;
      } else {
        // Memory fallback is explicit outside production when Redis is unavailable.
        const memoryEntry = this.getValidMemoryEntry(codeKey);
        if (!memoryEntry) {
          challengeCounter.delete(userId);
        }
        activeCount = challengeCounter.get(userId) ?? 0;
      }

      if (activeCount >= MAX_CONCURRENT_CHALLENGES) {
        secureLogger.warn('TWO_FACTOR_TOO_MANY_CHALLENGES', TWO_FACTOR_LOG_CONTEXT);
        return { success: false, tooManyChallenges: true, message: 'Too many active challenges' };
      }

      const code = this.generateCode();
      const codeHash = this.hashCode(code, userId);

      // IMPORTANT: the 2FA hash must be stored raw (not JSON) because Lua compares
      // the Redis value byte-for-byte during verification.
      const cacheWrite = await cacheService.setTwoFactorCodeHash(userId, codeHash, 300);
      if (!cacheWrite.ok) {
        if (!memoryStore || cacheWrite.reason !== 'client_unavailable') {
          secureLogger.error('TWO_FACTOR_CACHE_UNAVAILABLE', {
            ...TWO_FACTOR_LOG_CONTEXT,
            reason: cacheWrite.reason,
          });
          return {
            success: false,
            message: 'Service 2FA indisponible (cache)'
          };
        }
        memoryStore.set(codeKey, { hash: codeHash, expiresAt: Date.now() + 300000 });
        secureLogger.warn('TWO_FACTOR_MEMORY_FALLBACK_USED', {
          ...TWO_FACTOR_LOG_CONTEXT,
          reason: cacheWrite.reason,
        });
      }

      // Send email
      const emailResult = await send2FACode(email, code);

      if (emailResult.sent === false) {
        secureLogger.warn('TWO_FACTOR_EMAIL_FAILED', TWO_FACTOR_LOG_CONTEXT);
        return {
          success: false,
          message: 'Erreur lors de l\'envoi de l\'email'
        };
      }

      if (emailResult.skipped) {
        secureLogger.info('TWO_FACTOR_EMAIL_SKIPPED', TWO_FACTOR_LOG_CONTEXT);
      }

      // Generate a challengeId for the admin 2FA flow (one-time token, 600s TTL)
      const challengeId = require('crypto').randomUUID() as string;
      await cacheService.set(`2fa:challenge:${challengeId}`, userId, 600);

      // Increment concurrent challenge counter (Redis-first, memory fallback)
      if (sendRedisClient) {
        await sendRedisClient.incr(challengeCounterKey);
        await sendRedisClient.expire(challengeCounterKey, 300); // Matches code TTL — auto-expires with the code
      } else {
        challengeCounter.set(userId, (challengeCounter.get(userId) ?? 0) + 1);
      }

      return {
        success: true,
        challengeId,
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
        const ipHash = hashIpHmac(clientIp)!;

        const keys = [
          cacheKey,
          `2fa:attempts:user:${userId}`,
          `2fa:attempts:ip:${ipHash}`,
          `2fa:attempts:userip:${userId}:${ipHash}`
        ];

        const args = [
          providedHash,
          String(MAX_ATTEMPTS_PER_USER),
          String(MAX_ATTEMPTS_PER_IP),
          String(MAX_ATTEMPTS_PER_USER_IP),
          String(RATE_LIMIT_WINDOW_SECONDS)
        ];

        let result: unknown;

        // Try EVALSHA first (faster: ~30% latency reduction)
        if (luaScriptSha) {
          try {
            result = await redisClient.evalSha(luaScriptSha, {
              keys,
              arguments: args
            });
          } catch (error) {
            // If NOSCRIPT error (script flushed), fallback to EVAL and reload script
            if (error instanceof Error && error.message.includes('NOSCRIPT')) {
              secureLogger.warn('TWO_FACTOR_LUA_SCRIPT_NOSCRIPT_FALLBACK', TWO_FACTOR_LOG_CONTEXT);

              // Reload script for future requests (async, don't wait)
              loadLuaScript().catch(() => {}); // Ignore errors

              // Execute with EVAL as fallback
              result = await redisClient.eval(VERIFY_2FA_LUA_SCRIPT, {
                keys,
                arguments: args
              });
            } else {
              throw error; // Re-throw non-NOSCRIPT errors
            }
          }
        } else {
          // luaScriptSha not loaded yet, use EVAL directly
          result = await redisClient.eval(VERIFY_2FA_LUA_SCRIPT, {
            keys,
            arguments: args
          });
        }

        switch (result) {
          case 'VALID': {
            secureLogger.info('TWO_FACTOR_VERIFIED', TWO_FACTOR_LOG_CONTEXT);
            await this.decrementChallengeCounterRedis(userId, redisClient);
            return { valid: true, message: 'Code valide' };
          }

          case 'BLOCKED_USER':
          case 'BLOCKED_IP':
          case 'BLOCKED_USER_IP':
            secureLogger.warn('TWO_FACTOR_RATE_LIMITED', {
              ...TWO_FACTOR_LOG_CONTEXT,
              reason: result,
            });

            // Create SystemAlert for 2FA rate limiting (fire-and-forget, never fails 2FA flow)
            securityEventAlertService.reportTwoFactorRateLimit(
              userId,
              result as 'BLOCKED_USER' | 'BLOCKED_IP' | 'BLOCKED_USER_IP',
              ipHash
            ).catch(() => {}); // Ignore errors - alert failure should never block authentication

            return { valid: false, message: 'Trop de tentatives. Veuillez réessayer dans 5 minutes.' };

          case 'NO_CODE': {
            // Explicit memory fallback path: if Redis couldn't store the hash earlier,
            // keep dev/test usable without pretending Redis "miss" means "invalid" by accident.
            const fallback = await this.tryVerifyMemoryFallback(userId, providedHash, redisClient);
            if (fallback.valid) {
              return { valid: true, message: 'Code valide' };
            }
            if (fallback.usedFallback) {
              secureLogger.warn('TWO_FACTOR_VERIFICATION_FAILED', TWO_FACTOR_LOG_CONTEXT);
              return { valid: false, message: 'Code invalide ou expiré' };
            }
            secureLogger.warn('TWO_FACTOR_VERIFICATION_FAILED', TWO_FACTOR_LOG_CONTEXT);
            return { valid: false, message: 'Code invalide ou expiré' };
          }

          case 'INVALID':
          default:
            // Anti-oracle: unify NO_CODE and INVALID messages to prevent user enumeration
            // This prevents attackers from distinguishing whether a 2FA code exists or not
            secureLogger.warn('TWO_FACTOR_VERIFICATION_FAILED', TWO_FACTOR_LOG_CONTEXT);
            return { valid: false, message: 'Code invalide ou expiré' };
        }
      }

      const storedHash = await this.resolveStoredHash(userId);
      if (storedHash.status !== 'hit' || storedHash.hash !== providedHash) {
        // Anti-oracle: same generic message whether code is missing or invalid
        return {
          valid: false,
          message: 'Code invalide ou expiré'
        };
      }

      // Valid code - cleanup
      if (storedHash.source === 'memory' && memoryStore) {
        memoryStore.delete(cacheKey);
      } else {
        await cacheService.del(cacheKey);
      }

      // Decrement concurrent challenge counter
      if (redisClient) {
        await this.decrementChallengeCounterRedis(userId, redisClient);
      } else {
        this.decrementChallengeCounterMemory(userId);
      }

      secureLogger.info('TWO_FACTOR_VERIFIED', {
        ...TWO_FACTOR_LOG_CONTEXT,
      });

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
      const storedHash = await this.resolveStoredHash(userId);
      return storedHash.status === 'hit';
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
      // Detect whether a code exists (in either backend) before deleting,
      // so we only decrement the counter when a real challenge is cancelled.
      const storedHash = await this.resolveStoredHash(userId);
      const hadCode = storedHash.status === 'hit';
      await cacheService.del(cacheKey);
      if (memoryStore) {
        memoryStore.delete(cacheKey);
      }
      if (hadCode) {
        const cancelRedisClient = cacheService.getClient();
        if (cancelRedisClient) {
          const decrVal = await cancelRedisClient.decr(`2fa:challenges:${userId}`);
          if (decrVal <= 0) {
            await cancelRedisClient.del(`2fa:challenges:${userId}`);
          }
        } else {
          this.decrementChallengeCounterMemory(userId);
        }
      }
    } catch (error) {
      secureLogger.error('TWO_FACTOR_CANCEL_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const twoFactorService = new TwoFactorService();

/**
 * Resolve a challengeId to its userId and verify the 2FA code.
 * Used by the admin /verify-2fa endpoint to avoid accepting userId from client body.
 */
export async function verifyChallengeAndCode(
  challengeId: string,
  code: string,
  clientIp?: string | null,
): Promise<{ valid: boolean; userId?: string; message: string }> {
  const userId = await cacheService.get<string>(`2fa:challenge:${challengeId}`);
  if (!userId) {
    return { valid: false, message: 'Challenge invalide ou expiré' };
  }
  // Consume the challenge (one-time use)
  await cacheService.del(`2fa:challenge:${challengeId}`);
  const result = await twoFactorService.verifyCode(userId, code, clientIp ?? undefined);
  if (!result.valid) return { valid: false, message: result.message };
  return { valid: true, userId, message: result.message };
}

/**
 * Load 2FA Lua script into Redis at application startup.
 *
 * This function uses SCRIPT LOAD to pre-cache the Lua script in Redis,
 * allowing verifyCode() to use EVALSHA instead of EVAL.
 *
 * Benefits:
 * - Performance: ~30% latency reduction (no script parsing per request)
 * - Bandwidth: saves ~1.5KB per verification (script size)
 * - Robustness: automatic fallback to EVAL if Redis flushes scripts
 *
 * Should be called once at app startup (in index.ts).
 *
 * @returns Promise<boolean> - true if loaded successfully, false otherwise
 */
export async function loadLuaScript(): Promise<boolean> {
  try {
    const redisClient = cacheService.getClient();
    if (!redisClient) {
      secureLogger.warn('TWO_FACTOR_LUA_SCRIPT_LOAD_SKIPPED', {
        reason: 'Redis client not available'
      });
      return false;
    }

    // Load script and get SHA
    const sha = await redisClient.scriptLoad(VERIFY_2FA_LUA_SCRIPT);
    luaScriptSha = sha;

    secureLogger.info('TWO_FACTOR_LUA_SCRIPT_LOADED', {
      sha: sha.substring(0, 12) + '...', // Log first 12 chars only
      scriptSize: VERIFY_2FA_LUA_SCRIPT.length
    });

    return true;
  } catch (error) {
    secureLogger.error('TWO_FACTOR_LUA_SCRIPT_LOAD_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
