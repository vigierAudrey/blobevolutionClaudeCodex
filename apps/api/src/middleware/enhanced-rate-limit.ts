import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';
import { Request, Response, NextFunction } from 'express';
import { resolveRedisUrl } from '../lib/redisConfig';

type RedisClientType = ReturnType<typeof createClient>;

// Redis client (will be initialized based on environment)
let redisClient: RedisClientType | null = null;

// Initialize Redis client for production
async function initializeRedis(): Promise<RedisClientType | null> {
  const redisUrl = resolveRedisUrl();

  console.log('🔗 Connecting to Redis at:', redisUrl);

  try {
    const client = createClient({
      url: redisUrl,
      password: process.env.REDIS_PASSWORD?.trim() || undefined,
      socket: {
        connectTimeout: 4000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
      },
    });

    client.on('error', (error) => {
      console.error('❌ Redis error:', error.message);
    });

    await client.connect();
    await client.ping();
    console.log('✅ Redis connected for rate limiting');
    return client;
  } catch (error) {
    console.error('❌ Redis connection failed, falling back to memory store:', error);
    return null;
  }
}

// Initialize Redis on module load (not in test mode)
if (process.env.NODE_ENV !== 'test') {
  initializeRedis().then(client => {
    redisClient = client;
  });
}

// Rate limit configuration profiles
export const RATE_LIMIT_PROFILES = {
  // Authentication endpoints - stricter limits
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again later.',
      retryAfter: '15 minutes'
    }
  },

  // Registration/account creation - very strict
  REGISTRATION: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'REGISTRATION_RATE_LIMIT_EXCEEDED',
      message: 'Too many registration attempts. Please try again later.',
      retryAfter: '1 hour'
    }
  },

  // API endpoints - moderate limits
  API_STANDARD: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'API_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down.',
      retryAfter: '15 minutes'
    }
  },

  // Search/matching endpoints - higher limits but still controlled
  SEARCH: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 searches per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'SEARCH_RATE_LIMIT_EXCEEDED',
      message: 'Too many search requests. Please wait a moment.',
      retryAfter: '1 minute'
    }
  },

  // File upload endpoints - strict limits
  UPLOAD: {
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10, // 10 uploads per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'UPLOAD_RATE_LIMIT_EXCEEDED',
      message: 'Too many upload requests. Please wait before uploading again.',
      retryAfter: '10 minutes'
    }
  },

  // Admin endpoints - moderate limits but tracked
  ADMIN: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 50, // 50 admin actions per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'ADMIN_RATE_LIMIT_EXCEEDED',
      message: 'Too many admin requests. Please slow down.',
      retryAfter: '5 minutes'
    }
  },

  // Messaging endpoints - prevent spam
  MESSAGING: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // 10 messages per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'MESSAGING_RATE_LIMIT_EXCEEDED',
      message: 'Too many messages. Please wait before sending more.',
      retryAfter: '1 minute'
    }
  },

  // Email verification resend - prevent spam (P2-5)
  EMAIL_VERIFICATION: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 resend attempts per hour per email
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'EMAIL_VERIFICATION_RATE_LIMIT_EXCEEDED',
      message: 'Too many verification email requests. Please check your inbox or try again later.',
      retryAfter: '1 hour'
    }
  },

  // Global API protection - catch-all
  GLOBAL: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per window (very permissive)
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'GLOBAL_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP. Please try again later.',
      retryAfter: '15 minutes'
    }
  }
} as const;

// Create rate limiter with appropriate store
export function createRateLimiter(profile: keyof typeof RATE_LIMIT_PROFILES, customOptions: any = {}) {
  const config = RATE_LIMIT_PROFILES[profile];

  const options: any = {
    ...config,
    ...customOptions,
    // Use Redis store if available, otherwise memory store
    store: redisClient ? new RedisStore({
      sendCommand: (...args: string[]) => redisClient!.sendCommand(args),
    }) : undefined,

    // Use default key generator with proper IPv6 handling
    // The library handles IP normalization automatically

    // Skip function for certain conditions
    skip: (req: Request): boolean => {
      const enableInTests = String(process.env.ENABLE_RATE_LIMIT_IN_TESTS || '')
        .toLowerCase() === 'true';

      // Skip rate limiting in test environment unless explicitly enabled
      if (process.env.NODE_ENV === 'test' && !enableInTests) {
        return true;
      }

      // ✅ CORRIGÉ : Skip rate limiting in development for localhost
      if (process.env.NODE_ENV === 'development') {
        const isLocalhost = req.ip === '::1' ||
                           req.ip === '127.0.0.1' ||
                           req.ip === '::ffff:127.0.0.1' ||
                           req.hostname === 'localhost';
        if (isLocalhost) {
          return true;
        }
      }

      // Skip for health checks
      if (req.path === '/health') {
        return true;
      }

      // Skip for trusted IPs (if configured)
      const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
      if (req.ip && trustedIPs.includes(req.ip)) {
        return true;
      }

      return false;
    },

    // Enhanced handler for rate limit exceeded
    handler: (req: Request, res: Response) => {
      const retryAfter = res.get('Retry-After');

      // Log rate limit violations for security monitoring
      console.warn(`Rate limit exceeded: ${profile}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        userId: (req as any).user?.id,
        retryAfter
      });

      res.status(429).json({
        ...config.message,
        timestamp: new Date().toISOString(),
        endpoint: req.path,
        retryAfterSeconds: retryAfter
      });
    }
  };

  return rateLimit(options);
}

// Pre-configured rate limiters for common use cases (created once at startup)
export const rateLimiters = {
  auth: createRateLimiter('AUTH'),
  registration: createRateLimiter('REGISTRATION'),
  apiStandard: createRateLimiter('API_STANDARD'),
  search: createRateLimiter('SEARCH'),
  upload: createRateLimiter('UPLOAD'),
  admin: createRateLimiter('ADMIN'),
  messaging: createRateLimiter('MESSAGING'),
  global: createRateLimiter('GLOBAL')
};

// Middleware to apply appropriate rate limiting based on endpoint
export function smartRateLimit(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  const method = req.method;

  // Determine appropriate rate limiter based on path and method
  let limiter;

  if (path.startsWith('/auth/')) {
    if (method === 'GET') {
      limiter = rateLimiters.apiStandard;
    } else if (path.includes('/register')) {
      limiter = rateLimiters.registration;
    } else {
      limiter = rateLimiters.auth;
    }
  } else if (path.includes('/upload') || method === 'POST' && path.includes('/photo')) {
    limiter = rateLimiters.upload;
  } else if (path.includes('/search') || path.includes('/matching')) {
    limiter = rateLimiters.search;
  } else if (path.includes('/messages') || path.includes('/conversations')) {
    limiter = rateLimiters.messaging;
  } else if (path.startsWith('/admin/')) {
    limiter = rateLimiters.admin;
  } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    limiter = rateLimiters.apiStandard;
  } else {
    // GET requests get global rate limiting (more permissive)
    limiter = rateLimiters.global;
  }

  limiter(req, res, next);
}

// Cleanup function for graceful shutdown
export async function closeRateLimitStore(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    console.log('✅ Redis rate limit store closed');
  }
}
