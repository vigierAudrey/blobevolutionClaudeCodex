import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response, NextFunction } from 'express';
import { getRedisClient, redisClientInitPromise, closeRedisClient } from '../lib/redis-client';
import { getClientIp } from '../lib/client-ip';
import { hashIpHmacSafe } from '../lib/hash-ip';
import { hashEmailHmac } from '../lib/hash-email';
import { secureLogger } from '../utils/secure-logger';

type RateLimitStoreMode = 'memory' | 'redis';
type RateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => void;

// Tracks whether Redis init has settled (connected or failed).
// Used by lazy limiter factories to decide whether to await the init promise.
let redisInitSettled = process.env.NODE_ENV === 'test';

// Build the full set of rate limiters using the current Redis client.
// Called once at module load (getRedisClient()=null → memory store) and again
// after Redis connects (getRedisClient() non-null → Redis store).
// The second call uses Object.assign to mutate the exported object in place,
// so that all in-flight references (smartRateLimit, controllers) see Redis store.
function buildRateLimiters() {
  return {
    auth: createRateLimiter('AUTH'),
    registration: createRateLimiter('REGISTRATION'),
    apiStandard: createRateLimiter('API_STANDARD'),
    search: createRateLimiter('SEARCH'),
    geoHeavyBurst: createRateLimiter('GEO_HEAVY_BURST'),
    geoHeavyMinute: createRateLimiter('GEO_HEAVY_MINUTE'),
    upload: createRateLimiter('UPLOAD'),
    admin: createRateLimiter('ADMIN'),
    messaging: createRateLimiter('MESSAGING'),
    global: createRateLimiter('GLOBAL'),
  };
}

/**
 * Promise that resolves once Redis is connected AND rate limiters have been
 * rebuilt with the Redis store. Resolves immediately in test mode.
 *
 * The server MUST await this before calling httpServer.listen() to guarantee:
 *   - rate limiters use Redis store (not memory store) from the first request
 *   - startup is deterministic: Redis ready OR process.exit(1)
 * @public
 */
export let redisInitPromise: Promise<void> = Promise.resolve();

if (process.env.NODE_ENV !== 'test') {
  redisInitPromise = redisClientInitPromise
    .then(() => {
      const client = getRedisClient();
      if (client) {
        // Rebuild rate limiters with the now-connected Redis store.
        // Object.assign mutates the exported `rateLimiters` object in place so
        // smartRateLimit and any other reference sees the Redis-backed limiters
        // without requiring a module reload.
        Object.assign(rateLimiters, buildRateLimiters());
        secureLogger.info('RATE_LIMITERS_REBUILT_WITH_REDIS');
      }
    })
    .catch((err) => {
      // In production: redis-client.ts already called process.exit(1).
      // This catch handles non-production/non-development environments.
      secureLogger.error('RATE_LIMIT_REDIS_INIT_FAILED', {
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      redisInitSettled = true;
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

  // Heavy geospatial endpoints (PostGIS distance + radius filters)
  GEO_HEAVY_BURST: {
    windowMs: 10 * 1000, // 10 seconds
    max: 4, // burst budget
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'GEO_HEAVY_BURST_RATE_LIMIT_EXCEEDED',
      message: 'Too many geospatial requests in a short period. Please slow down.',
      retryAfter: '10 seconds'
    }
  },

  GEO_HEAVY_MINUTE: {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // sustained budget
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'GEO_HEAVY_MINUTE_RATE_LIMIT_EXCEEDED',
      message: 'Too many geospatial requests. Please try again shortly.',
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

  // Admin endpoints — dashboard fires 5-7 parallel requests per page load.
  // 300/5min (= 60/min) allows ~60 page loads per window while still rate-limiting
  // unauthenticated probing. Auth, IP-allowlist, role checks and step-up provide
  // the real security; this limit only guards against mass unauthenticated probing.
  ADMIN: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 300, // 300 admin requests per window
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

  // Email verification resend — short cooldown per email (R5: prevents button spam)
  EMAIL_VERIFICATION_COOLDOWN: {
    windowMs: 60 * 1000, // 1 minute
    max: 1, // 1 per minute per email
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'EMAIL_VERIFICATION_COOLDOWN',
      message: 'Please wait before requesting another verification email.',
      retryAfter: '1 minute'
    }
  },

  // Email verification resend — hourly quota per email (P2-5)
  EMAIL_VERIFICATION: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 resend attempts per hour per email (raised from 3 since cooldown filters button spam)
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'EMAIL_VERIFICATION_RATE_LIMIT_EXCEEDED',
      message: 'Too many verification email requests. Please check your inbox or try again later.',
      retryAfter: '1 hour'
    }
  },

  PASSWORD_RESET_EMAIL: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 reset email attempts per hour per email
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED',
      message: 'Too many password reset requests. Please check your inbox or try again later.',
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
  const client = getRedisClient();
  const defaultStore = client ? new RedisStore({
    sendCommand: (...args: string[]) => client.sendCommand(args),
  }) : undefined;

  const options: any = {
    ...config,
    store: defaultStore,
    ...customOptions,

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

      // Skip in development for localhost — use socket IP (not req.ip which may be
      // Cloudflare-resolved when trust proxy is active)
      if (process.env.NODE_ENV === 'development') {
        const socketIp = req.socket?.remoteAddress;
        const isLocalhost = socketIp === '::1' ||
                           socketIp === '127.0.0.1' ||
                           socketIp === '::ffff:127.0.0.1' ||
                           req.hostname === 'localhost';
        if (isLocalhost) {
          return true;
        }
      }

      // Skip for health checks
      if (req.path === '/health') {
        return true;
      }

      // Skip for trusted IPs — use canonical IP (Cloudflare-aware) not raw req.ip
      const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
      if (trustedIPs.length > 0) {
        const clientIp = (req as Request & { canonicalIp?: string }).canonicalIp ?? getClientIp(req) ?? req.socket?.remoteAddress;
        if (clientIp && trustedIPs.includes(clientIp)) {
          return true;
        }
      }

      return false;
    },

    // Enhanced handler for rate limit exceeded
    handler: (req: Request, res: Response) => {
      const retryAfter = res.get('Retry-After');
      const ipHash = hashIpHmacSafe(getClientIp(req));

      // Log rate limit violations for security monitoring
      secureLogger.warn('RATE_LIMIT_EXCEEDED', {
        profile,
        ipHash,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        userId: (req as any).user?.id,
        retryAfter
      });

      res.status(429).json({
        ...config.message,
        timestamp: new Date().toISOString(),
        retryAfterSeconds: retryAfter
      });
    }
  };

  if (!customOptions?.keyGenerator) {
    options.keyGenerator = (req: Request) => {
      // Email-keyed endpoints: per-email limit (IP-independent, prevents ISP NAT bypass)
      if (profile === 'EMAIL_VERIFICATION' || profile === 'EMAIL_VERIFICATION_COOLDOWN' || profile === 'PASSWORD_RESET_EMAIL') {
        const fromBody = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const fromQuery = typeof req.query?.email === 'string' ? String(req.query.email).trim().toLowerCase() : '';
        const identifierSource = fromBody || fromQuery;
        if (identifierSource) {
          return `email:${hashEmailHmac(identifierSource)}`;
        }
      }
      // Canonical IP key: uses CF-Connecting-IP when behind Cloudflare (see client-ip.ts).
      // Never uses req.ip directly — req.ip may resolve to Cloudflare edge IP.
      const ip = (req as Request & { canonicalIp?: string }).canonicalIp
        ?? getClientIp(req)
        ?? req.socket?.remoteAddress;
      return ip ? ipKeyGenerator(ip) : 'anonymous';
    };
  }

  return rateLimit(options);
}

function getStoreMode(): RateLimitStoreMode {
  return getRedisClient() ? 'redis' : 'memory';
}

type GeoRateLimitProfile = 'GEO_HEAVY_BURST' | 'GEO_HEAVY_MINUTE';

/**
 * Create endpoint-specific geospatial limiters keyed by endpoint + user + IP.
 * This blocks simple bucket-rotation attacks and limits denial-of-wallet scans.
 */
export function createGeoEndpointLimiter(endpointKey: string, profile: GeoRateLimitProfile) {
  const normalizedEndpoint = endpointKey.toLowerCase().replace(/[^a-z0-9:_-]/g, '_');
  const normalizedProfile = profile.toLowerCase();
  const keyGenerator = (req: Request) => {
    const userId = (req as Request & { user?: { id?: string } }).user?.id ?? 'anonymous';
    // Use canonical IP (Cloudflare-aware) — req.ip may be Cloudflare edge IP
    const ip = getClientIp(req) ?? req.socket?.remoteAddress;
    const ipToken = ip ? ipKeyGenerator(ip) : 'ip:unknown';
    return `geo:${normalizedEndpoint}:${normalizedProfile}:u:${userId}:ip:${ipToken}`;
  };

  const memoryLimiter = createRateLimiter(profile, { keyGenerator, store: undefined });
  let redisLimiter: RateLimitMiddleware | null = null;

  const buildRedisLimiter = () => {
    const client = getRedisClient();
    if (!client || redisLimiter) {
      return;
    }
    redisLimiter = createRateLimiter(profile, {
      keyGenerator,
      store: new RedisStore({
        sendCommand: (...args: string[]) => client.sendCommand(args),
      }),
    });
  };

  if (process.env.NODE_ENV !== 'test') {
    void redisInitPromise.then(() => {
      buildRedisLimiter();
    }).catch(() => undefined);
  } else {
    buildRedisLimiter();
  }

  const executeLimiter = (req: Request, res: Response, next: NextFunction) => {
    const limiter = getStoreMode() === 'redis' && redisLimiter ? redisLimiter : memoryLimiter;
    return limiter(req, res, next);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test' || redisInitSettled) {
      return executeLimiter(req, res, next);
    }

    void redisInitPromise
      .catch(() => undefined)
      .then(() => executeLimiter(req, res, next));
  };
}

// ─── Architecture Rule: Lazy Rate-Limiter Factories ──────────────────────────
//
// NEVER call rateLimit({}) or createRateLimiter() at module top-level (controller imports).
// These functions resolve `getRedisClient()` at call-time. If called before Redis bootstrap
// (always true for synchronously-imported controller modules), the store is permanently
// memory — breaking cross-restart consistency and multi-instance rate-limit sharing.
//
// MANDATORY alternatives for controller-level limiters:
//   createLazyRateLimiter(profile, options?)     — profile-based limiters
//   createLazyCustomRateLimiter(options, prefix)  — custom rateLimit({}) configs
//   createGeoEndpointLimiter(key, profile)        — geo/user-keyed (already lazy)
//
// All three resolve the store at REQUEST TIME, after redisInitSettled=true,
// ensuring Redis store is used from the first real request in production.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Profile-based lazy rate limiter.
 * Drop-in replacement for createRateLimiter() at module top-level.
 * Creates the underlying limiter on first request, after Redis bootstrap.
 * Each mode (memory / redis) gets its own limiter instance (cached per closure).
 *
 * @example
 *   // Instead of: const myLimiter = createRateLimiter('AUTH');
 *   const myLimiter = createLazyRateLimiter('AUTH');
 */
export function createLazyRateLimiter(
  profile: keyof typeof RATE_LIMIT_PROFILES,
  customOptions: any = {},
): (req: Request, res: Response, next: NextFunction) => void {
  let memoryLimiter: ReturnType<typeof rateLimit> | null = null;
  let redisLimiter: ReturnType<typeof rateLimit> | null = null;

  const run = (req: Request, res: Response, next: NextFunction) => {
    const validate = {
      creationStack: false,
      keyGeneratorIpFallback: false,
      ...(customOptions?.validate ?? {}),
    };

    if (getRedisClient()) {
      if (!redisLimiter) {
        redisLimiter = createRateLimiter(profile, { ...customOptions, validate });
      }
      return redisLimiter(req, res, next);
    }
    if (!memoryLimiter) {
      memoryLimiter = createRateLimiter(profile, { ...customOptions, validate });
    }
    return memoryLimiter(req, res, next);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test' || redisInitSettled) {
      return run(req, res, next);
    }
    void redisInitPromise.catch(() => undefined).then(() => run(req, res, next));
  };
}

/**
 * Custom-options lazy rate limiter.
 * Drop-in replacement for rateLimit({...}) at module top-level.
 * Accepts the same options as rateLimit() but lazily attaches Redis store
 * when Redis is available, falling back to memory store otherwise.
 *
 * @param options    - Same options as express-rate-limit rateLimit(). Do NOT include `store`.
 * @param storePrefix - Unique Redis key prefix for this limiter (e.g. 'booking_request').
 *                      Must be unique across all createLazyCustomRateLimiter calls to avoid
 *                      inadvertent counter sharing between unrelated limiters.
 *
 * @example
 *   // Instead of: const myLimiter = rateLimit({ windowMs: 60_000, max: 5, ... });
 *   const myLimiter = createLazyCustomRateLimiter({ windowMs: 60_000, max: 5, ... }, 'my_limiter');
 */
export function createLazyCustomRateLimiter(
  options: any,
  storePrefix: string,
): (req: Request, res: Response, next: NextFunction) => void {
  let memoryLimiter: ReturnType<typeof rateLimit> | null = null;
  let redisLimiter: ReturnType<typeof rateLimit> | null = null;

  // Wrap skip to add consistent skip-in-tests/dev-localhost logic (same as createRateLimiter)
  const callerSkip = options?.skip;
  const skipFn = (req: Request): boolean => {
    const enableInTests = String(process.env.ENABLE_RATE_LIMIT_IN_TESTS ?? '').toLowerCase() === 'true';
    if (process.env.NODE_ENV === 'test' && !enableInTests) return true;
    if (process.env.NODE_ENV === 'development') {
      const socketIp = req.socket?.remoteAddress;
      const isLocalhost =
        socketIp === '::1' ||
        socketIp === '127.0.0.1' ||
        socketIp === '::ffff:127.0.0.1' ||
        req.hostname === 'localhost';
      if (isLocalhost) return true;
    }
    return callerSkip ? (callerSkip as (r: Request) => boolean)(req) : false;
  };

  const run = (req: Request, res: Response, next: NextFunction) => {
    const validate = {
      creationStack: false,
      keyGeneratorIpFallback: false,
      ...(options?.validate ?? {}),
    };

    const client = getRedisClient();
    if (client) {
      if (!redisLimiter) {
        redisLimiter = rateLimit({
          ...options,
          validate,
          skip: skipFn,
          store: new RedisStore({
            sendCommand: (...args: string[]) => client.sendCommand(args),
            prefix: `rl:${storePrefix}:`,
          }),
        });
      }
      return redisLimiter(req, res, next);
    }
    if (!memoryLimiter) {
      memoryLimiter = rateLimit({
        ...options,
        validate,
        skip: skipFn,
      });
    }
    return memoryLimiter(req, res, next);
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test' || redisInitSettled) {
      return run(req, res, next);
    }
    void redisInitPromise.catch(() => undefined).then(() => run(req, res, next));
  };
}

// Pre-configured rate limiters for the global smartRateLimit middleware.
// Initially built with memory store (getRedisClient()=null at module-load time).
// After Redis connects, buildRateLimiters() rebuilds them in-place via Object.assign.
// All controller-level limiters use createLazyRateLimiter / createLazyCustomRateLimiter
// (defined above) — no limiter remains frozen on memory store after bootstrap.
export const rateLimiters = buildRateLimiters();

// Middleware to apply appropriate rate limiting based on endpoint
export function smartRateLimit(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  const method = req.method;
  const isConversationMessagesRoute = /^\/conversations\/[^/]+\/messages$/.test(path);

  // Some authenticated routes already enforce narrower, post-auth rate limits.
  // Keeping the global pre-auth IP bucket here would mostly measure NAT collisions.
  if (path.startsWith('/matching/')) {
    return next();
  }
  if (path === '/auth/login' && method === 'POST') {
    return next();
  }
  if (path === '/auth/register' && method === 'POST') {
    return next();
  }
  // /auth/2fa/send has dedicated IP + email keyed limiters in auth.controller.
  if (path === '/auth/2fa/send' && method === 'POST') {
    return next();
  }
  // These routes have route-level controls or must remain available to end a session.
  // Avoid charging them against the shared pre-auth IP bucket.
  if (
    method === 'POST' &&
    (path === '/auth/step-up' || path === '/auth/verify-2fa' || path === '/auth/logout')
  ) {
    return next();
  }
  if (path === '/conversations' && method === 'GET') {
    return next();
  }
  if (path === '/conversations/open' && method === 'POST') {
    return next();
  }
  if (isConversationMessagesRoute && ['GET', 'POST'].includes(method)) {
    return next();
  }
  // Lectures annexes de conversation : limiter dédié par utilisateur
  // (conversationReadLimiter) — le bucket IP MESSAGING (10/min) déclenchait
  // des 429 en navigation normale (« Membres (0) » à l'ouverture d'une conv).
  const isConversationReadRoute =
    method === 'GET' &&
    (/^\/conversations\/[^/]+\/members$/.test(path) ||
      path === '/conversations/invitations/pending' ||
      path === '/conversations/users/search');
  if (isConversationReadRoute) {
    return next();
  }

  // Determine appropriate rate limiter based on path and method
  let limiter;

  if (path === '/auth/resend-verification' || path === '/auth/forgot-password') {
    // These routes enforce dedicated IP + email keyed budgets in auth.controller.
    return next();
  }

  if (path.startsWith('/auth/')) {
    if (method === 'GET') {
      limiter = rateLimiters.apiStandard;
    } else if (path.includes('/register')) {
      limiter = rateLimiters.registration;
    } else {
      limiter = rateLimiters.auth;
    }
  } else if (path.includes('/upload') || method === 'POST' && path.includes('/photo')) {
    // /pro/photo/upload-url has its own user-keyed uploadUrlRateLimiter in the route.
    // Excluding it from the shared IP bucket prevents premature 429 when finalize and
    // upload-url exhaust the same 10/10min counter. Falls through to apiStandard (POST).
    // /profile/photo/finalize and /pro/photo/finalize have a dedicated per-userId
    // finalizeRateLimiter wired directly on the route — bypassing the shared IP bucket
    // here prevents double-counting that causes spurious 429 for legitimate users.
    if (path.endsWith('/photo/upload-url')) {
      limiter = rateLimiters.apiStandard;
    } else if (path.endsWith('/photo/finalize')) {
      return next();
    } else {
      limiter = rateLimiters.upload;
    }
  } else if (path.includes('/search') || path.includes('/matching')) {
    limiter = rateLimiters.search;
  } else if (path.startsWith('/admin/')) {
    limiter = rateLimiters.admin;
  } else if (path.includes('/messages') || path.includes('/conversations')) {
    limiter = rateLimiters.messaging;
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
  await closeRedisClient();
}
