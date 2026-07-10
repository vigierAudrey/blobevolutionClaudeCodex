import './config/loadEnv';

// Validate production environment variables (fail-fast on insecure defaults)
import { validateProductionEnv, validateBruteForceEnv, validateAdminStatsCacheEnv } from './lib/env-validation';
validateProductionEnv();
validateBruteForceEnv();
validateAdminStatsCacheEnv();

const emailHashSecret = process.env.EMAIL_HASH_SECRET?.trim();
if (!emailHashSecret) {
  throw new Error('FATAL: EMAIL_HASH_SECRET is not configured. Set EMAIL_HASH_SECRET in .env before starting the API.');
}

if (emailHashSecret === 'change-me-strong-email-hash-secret-production-min-32-chars' || emailHashSecret === 'change-me') {
  throw new Error(
    'FATAL: EMAIL_HASH_SECRET uses an insecure placeholder. Generate a strong unique value in .env before starting the API.'
  );
}

import { resolve } from 'path';
import fs from 'fs';
import { randomBytes, timingSafeEqual } from 'crypto';
import { createServer } from 'http';

// Standard logging for monitoring (Clever Cloud logs)
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import YAML from 'js-yaml';
import helmet from 'helmet';
import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { secureLogger } from './utils/secure-logger';
import { getClientIp } from './lib/client-ip';
import { hashIpHmacSafe } from './lib/hash-ip';
import { requestIdMiddleware } from './middleware/request-id';
import { healthRouter } from './modules/health/health.router';
import { runJobWithLogContext, withHttpLogContext } from './observability/log-context';
import { registerLogTransportShutdownHandlers, getLogTransportMetrics } from './observability/log-transport';
import { getEmailMetricsSnapshot } from './lib/email-metrics';
import { getMatchingMetricsSnapshot } from './lib/matching-metrics';
import { incHttpRequest, incHttp5xx, recordHttpLatency, isExcludedPath, getHttpMetricsSnapshot } from './lib/http-metrics';
import { httpAccessLog } from './middleware/http-access-log';
import { buildSessionStore } from './lib/session-store';
import { redisClientInitPromise } from './lib/redis-client';

const RAW_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const DEV_FALLBACK_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:4173',
  'http://127.0.0.1:4173'
]);

const allowedOriginsSet = (() => {
  if (RAW_ALLOWED_ORIGINS.length > 0) {
    return new Set(RAW_ALLOWED_ORIGINS);
  }
  if (process.env.NODE_ENV !== 'production') {
    return DEV_FALLBACK_ORIGINS;
  }
  return new Set<string>();
})();

if (process.env.NODE_ENV === 'production' && allowedOriginsSet.size === 0) {
  throw new Error('ALLOWED_ORIGINS must be set in production to a comma-separated list of origins');
}

const MIN_SECRET_LENGTH = 64;
const REQUIRED_SECRETS = ['SESSION_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

function ensureProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') {
    const weak = REQUIRED_SECRETS.filter((key) => {
      const value = process.env[key];
      return !value || value.length < MIN_SECRET_LENGTH;
    });

    if (weak.length > 0) {
      secureLogger.warn('WEAK_SECRETS_DETECTED', { secrets: weak });
    }
    return;
  }

  const missing = REQUIRED_SECRETS.filter((key) => {
    const value = process.env[key];
    return !value || value.length < MIN_SECRET_LENGTH;
  });

  if (missing.length > 0) {
    throw new Error(`Missing or weak secrets in production: ${missing.join(', ')}`);
  }
}

ensureProductionSecrets();

// R-01 — warn at startup if METRICS_INTERNAL_TOKEN is absent.
// No fail-fast: a missing token disables the endpoint (401 on every call),
// but does not prevent the API from serving traffic.
// Skipped in test env to avoid polluting test output.
if (process.env.NODE_ENV !== 'test' && !process.env.METRICS_INTERNAL_TOKEN) {
  secureLogger.warn('METRICS_INTERNAL_TOKEN_MISSING', {
    impact: '/internal/metrics will always return 401; internal metrics monitoring is disabled',
  });
}

function getRequestIpHash(req: Request): string | undefined {
  return hashIpHmacSafe(getClientIp(req) ?? req.socket?.remoteAddress);
}

const cspConnectSrc = new Set(["'self'"]);
if (allowedOriginsSet.size > 0) {
  allowedOriginsSet.forEach(origin => cspConnectSrc.add(origin));
} else {
  DEV_FALLBACK_ORIGINS.forEach(origin => cspConnectSrc.add(origin));
}

const generateNonce = () => randomBytes(16).toString('base64');

const resolveCspReportOnly = () => {
  if (typeof process.env.CSP_REPORT_ONLY === 'string') {
    return process.env.CSP_REPORT_ONLY.toLowerCase() === 'true';
  }
  return process.env.NODE_ENV !== 'production';
};

const applyNoncesToHtml = (html: string, scriptNonce?: string, styleNonce?: string) => {
  let result = html;
  if (typeof scriptNonce === 'string' && scriptNonce.length > 0) {
    result = result.replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${scriptNonce}"`);
  }
  if (typeof styleNonce === 'string' && styleNonce.length > 0) {
    result = result.replace(/<style\b(?![^>]*\bnonce=)/g, `<style nonce="${styleNonce}"`);
  }
  return result;
};

const createHelmetMiddleware = () => helmet({
  contentSecurityPolicy: {
    reportOnly: resolveCspReportOnly(),
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        (_req, res) => {
          const expressRes = res as Response;
          const nonce = expressRes.locals?.cspNonceScript;
          if (typeof nonce === 'string' && nonce.length > 0) {
            return `'nonce-${nonce}'`;
          }
          const fallback = generateNonce();
          expressRes.locals.cspNonceScript = fallback;
          return `'nonce-${fallback}'`;
        }
      ],
      styleSrc: [
        "'self'",
        (_req, res) => {
          const expressRes = res as Response;
          const nonce = expressRes.locals?.cspNonceStyle;
          if (typeof nonce === 'string' && nonce.length > 0) {
            return `'nonce-${nonce}'`;
          }
          const fallback = generateNonce();
          expressRes.locals.cspNonceStyle = fallback;
          return `'nonce-${fallback}'`;
        }
      ],
      connectSrc: Array.from(cspConnectSrc),
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // P2-3: Compatible avec OAuth
  frameguard: { action: 'deny' },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false
});

const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (origin) {
    if (!allowedOriginsSet.has(origin)) {
      secureLogger.warn('CORS_ORIGIN_BLOCKED', { origin });
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  const requestedHeaders = req.headers['access-control-request-headers'];
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    typeof requestedHeaders === 'string' && requestedHeaders.length > 0
      ? requestedHeaders
      : 'Content-Type, Authorization, X-CSRF-Token, X-XSRF-Token'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
};

import compression from 'compression';
import { setupCSRF, csrfProtection, getCSRFToken } from './middleware/csrf';
import { smartRateLimit } from './middleware/enhanced-rate-limit';
import { authRouter } from './modules/auth/auth.controller';
import { profileRouter } from './modules/profile/profile.controller';
import { matchingRouter } from './modules/matching/matching.controller';
import { reportsRouter } from './modules/reports/reports.controller';
import { conversationsRouter } from './modules/chat/conversations.controller';
import { proRouter } from './modules/pro/pro.controller';
import { proPublicRouter } from './modules/pro/pro.public';
import { mediaRouter } from './modules/media/media.controller';
import { adminRouter } from './modules/admin/admin.controller';
import { securityRouter } from './modules/security/security.controller';
import { blobosphereAdminRouter } from './modules/blobosphere/blobosphere.controller';
import { blobospherePublicRouter } from './modules/blobosphere/blobosphere.public';
import { contactRouter } from './modules/contact/contact.controller';
import pushRouter from './modules/push/push.controller';
import { notificationsRouter } from './modules/notifications/notifications.controller';
import { consentRouter } from './modules/consent/consent.controller';
import { analyticsRouter } from './modules/analytics/analytics.controller';


const OPENAPI_SPEC_CANDIDATES = [
  resolve(process.cwd(), 'docs/openapi/openapi.yaml'),
  resolve(process.cwd(), '../../docs/openapi/openapi.yaml'),
  resolve(__dirname, '../docs/openapi/openapi.yaml'),
  resolve(__dirname, '../../../docs/openapi/openapi.yaml'),
];

const resolveOpenApiSpecPath = (): string | null =>
  OPENAPI_SPEC_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;

const loadOpenApiDocument = () => {
  try {
    const specPath = resolveOpenApiSpecPath();
    if (!specPath) {
      throw new Error(`OpenAPI spec not found in candidates: ${OPENAPI_SPEC_CANDIDATES.join(', ')}`);
    }
    const raw = fs.readFileSync(specPath, 'utf-8');
    return YAML.load(raw) as object;
  } catch (error) {
    secureLogger.warn('OPENAPI_LOAD_FAILED', { error });
    return null;
  }
};

export function createApp() {
  const app = express();
  app.use(withHttpLogContext);

  // Production-grade compression (gzip/brotli)
  app.use(compression({
    // Only compress responses larger than 1KB
    threshold: 1024,
    // Compression level (1=fastest, 6=good balance, 9=best compression)
    level: process.env.NODE_ENV === 'production' ? 6 : 1,
    // Custom filter for compression
    filter: (req, res) => {
      // Don't compress responses with this request header
      if (req.headers['x-no-compression']) {
        return false;
      }
      // Use compression default filter (compresses text, json, etc.)
      return compression.filter(req, res);
    }
  }));
  const analyticsJsonLimit = process.env.ANALYTICS_EVENT_MAX_BYTES || '8kb';
  app.use('/analytics', express.json({ limit: analyticsJsonLimit }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);

  // Trust proxy configuration - more secure than 'true'
  // In dev, trust localhost. In prod, trust only known proxy IPs or use number of hops
  if (process.env.NODE_ENV === 'production') {
    const trustedProxiesEnv = process.env.TRUSTED_PROXY_IPS?.split(',').map(v => v.trim()).filter(Boolean) || [];
    if (trustedProxiesEnv.length === 0) {
      throw new Error('TRUSTED_PROXY_IPS must be set in production to a comma-separated list of proxy IPs/CIDR ranges');
    }
    app.set('trust proxy', trustedProxiesEnv);
  } else {
    app.set('trust proxy', ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
  }

  // Session configuration for CSRF
  const sessionSecret = process.env.SESSION_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set in production');
    }
    secureLogger.warn('DEV_SESSION_SECRET_FALLBACK_USED');
    return 'blobinfini-dev-secret-change-in-production';
  })();

  const sessionStoreInstance = buildSessionStore();
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStoreInstance,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
    }
  }));

  app.use(corsMiddleware);
  app.use((_req, res, next) => {
    res.locals.cspNonceScript = generateNonce();
    res.locals.cspNonceStyle = generateNonce();
    next();
  });
  app.use(createHelmetMiddleware());

  // Health probes — montées APRÈS cors + CSP/helmet (les sondes reçoivent donc
  // les en-têtes CORS/CSP et le preflight OPTIONS est géré comme pour les autres
  // routes), mais AVANT smartRateLimit (un LB poll fréquemment, jamais rate-limité)
  // et avant la protection CSRF (GET/OPTIONS non concernés).
  //  - /health/live : liveness — ne touche aucune dépendance infra (la sonde sans
  //    cookie ne déclenche aucun accès au store de session).
  //  - /health/ready : readiness (DB dure, Redis/storage souples), timeouts courts.
  //  - /health : compat héritée ({ status: 'ok' }).
  app.use('/health', healthRouter);

  // Global rate limiting (before specific routes)
  app.use(smartRateLimit);

  // CSRF setup (must be after session and before routes)
  app.use(setupCSRF);

  // Enhanced GDPR purge system with legal protection
  const gdprPurgeHours = Number(process.env.GDPR_PURGE_INTERVAL_HOURS || '24'); // Daily by default
  const legacyPurgeHours = Number(process.env.CONSENT_PURGE_INTERVAL_HOURS || '0'); // Legacy system
  const purgeDays = Number(process.env.CONSENT_PURGE_RETENTION_DAYS || '730');
  const convPurgeHours = Number(process.env.CONV_PURGE_INTERVAL_HOURS || '0');
  // 90j aligné sur gdpr-purge.service.ts purgeRelationalData() — RGPD Phase 1
  const convTrashDays = Number(process.env.CONV_TRASH_RETENTION_DAYS || '90');
  // Expiration des demandes de cours (BloboMap) — toutes les 6h par défaut :
  // la fenêtre d'expiration est à minuit UTC, 4 passages/jour bornent le retard.
  const lessonExpiryHours = Number(process.env.LESSON_EXPIRY_INTERVAL_HOURS || '6');
  async function purgeOnce() {
    await runJobWithLogContext('consent-purge', async () => {
      try {
        const threshold = new Date(Date.now() - purgeDays * 24 * 60 * 60 * 1000);
        const { clientPrisma: prisma } = await import('@blobinfini/database');
        // Purge raw consentIp (legacy)
        await prisma.user.updateMany({
          where: { consentIp: { not: null }, consentedAt: { lt: threshold } },
          data: { consentIp: null },
        });
        // Purge consentIpHash (HMAC v2) - RGPD data minimization
        await prisma.user.updateMany({
          where: { consentIpHash: { not: null }, consentedAt: { lt: threshold } },
          data: { consentIpHash: null },
        });
      } catch (e) {
        secureLogger.error('CONSENT_PURGE_FAILED', { error: e });
      }
    });
  }
  // Enhanced GDPR purge system
  async function performGDPRPurge() {
    await runJobWithLogContext('gdpr-purge', async () => {
      try {
        const { gdprPurgeService } = await import('./services/gdpr-purge.service.js');
        await gdprPurgeService.performFullPurge();
      } catch (e) {
        secureLogger.error('GDPR_PURGE_FAILED', { error: e });
      }
    });
  }

  // Expiration des demandes de cours périmées (date passée / sans date > TTL)
  async function runLessonExpiry() {
    await runJobWithLogContext('lesson-expiry', async () => {
      try {
        const { expireLessonRequests } = await import('./jobs/expireLessonRequests.js');
        await expireLessonRequests();
      } catch (e) {
        secureLogger.error('LESSON_EXPIRY_FAILED', { error: e });
      }
    });
  }

  // Only start background jobs in production/development, not in tests
  if (process.env.NODE_ENV !== 'test') {
    if (gdprPurgeHours > 0) {
      setInterval(performGDPRPurge, gdprPurgeHours * 60 * 60 * 1000);
      if (String(process.env.GDPR_PURGE_RUN_ON_START || 'false').toLowerCase() === 'true') {
        performGDPRPurge();
      }
    }

    // Legacy consent IP purge (fallback if GDPR purge disabled)
    if (legacyPurgeHours > 0 && gdprPurgeHours === 0) {
      setInterval(purgeOnce, legacyPurgeHours * 60 * 60 * 1000);
      if (String(process.env.CONSENT_PURGE_RUN_ON_START || 'true').toLowerCase() === 'true') {
        purgeOnce();
      }
    }

    // Background auto-deletion of trashed conversations (per member)
    if (convPurgeHours > 0) {
      setInterval(purgeTrashedConversations, convPurgeHours * 60 * 60 * 1000);
      purgeTrashedConversations();
    }

    // Expiration des demandes de cours périmées
    if (lessonExpiryHours > 0) {
      setInterval(runLessonExpiry, lessonExpiryHours * 60 * 60 * 1000);
      runLessonExpiry();
    }
  }

  // Background auto-deletion of trashed conversations (per member)
  async function purgeTrashedConversations() {
    await runJobWithLogContext('conversation-trash-purge', async () => {
      try {
        const cutoff = new Date(Date.now() - convTrashDays * 24 * 60 * 60 * 1000);
        const { clientPrisma: prisma } = await import('@blobinfini/database');
        // Remove memberships older than cutoff
        await prisma.conversationMember.deleteMany({ where: { trashedAt: { not: null, lt: cutoff } } });
        // Remove orphan conversations (no members)
        await prisma.conversation.deleteMany({ where: { members: { none: {} } } });
      } catch (e) {
        secureLogger.error('CONVERSATION_PURGE_FAILED', { error: e });
      }
    });
  }

  // (Health probes /health, /health/live, /health/ready sont montées plus haut,
  //  avant session/rate-limit/CSRF — voir createApp() début.)

  // CSRF token endpoint (GET requests are not protected)
  app.get('/csrf-token', getCSRFToken);

  // OpenAPI specification & Swagger UI
  app.get('/openapi.yaml', (_req, res) => {
    const specPath = resolveOpenApiSpecPath();
    if (!specPath) {
      secureLogger.warn('OPENAPI_LOAD_FAILED', {
        error: `OpenAPI spec not found in candidates: ${OPENAPI_SPEC_CANDIDATES.join(', ')}`,
      });
      return res.status(500).json({ error: 'OpenAPI specification unavailable' });
    }
    res.sendFile(specPath);
  });

  app.get('/openapi.json', (_req, res) => {
    const document = loadOpenApiDocument();
    if (!document) {
      return res.status(500).json({ error: 'OpenAPI specification unavailable' });
    }
    res.json(document);
  });

  const swaggerDocument = loadOpenApiDocument();
  if (swaggerDocument) {
    const swaggerOptions = {
      explorer: true,
      customSiteTitle: 'Blob API – Swagger UI',
      swaggerOptions: {
        deepLinking: true
      }
    };
    app.use(
      '/api/docs',
      swaggerUi.serve,
      (_req: Request, res: Response) => {
        const scriptNonce = res.locals.cspNonceScript as string | undefined;
        const styleNonce = res.locals.cspNonceStyle as string | undefined;
        const html = swaggerUi.generateHTML(swaggerDocument, swaggerOptions);
        res.send(applyNoncesToHtml(html, scriptNonce, styleNonce));
      }
    );
  }

  // Apply CSRF protection to all routes
  app.use(csrfProtection);

  // HTTP access log — method, path, status, duration_ms, request_id, actor_ref (no PII).
  app.use(httpAccessLog);

  // HTTP metrics middleware — no PII, no payload.
  // Excluded paths (health, /internal/metrics, etc.) are not counted to avoid
  // inflating application traffic counters with monitoring probes.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isExcludedPath(req.path)) {
      return next();
    }
    const start = Date.now();
    incHttpRequest();
    res.on('finish', () => {
      const ms = Date.now() - start;
      recordHttpLatency(ms);
      if (res.statusCode >= 500) {
        incHttp5xx();
      }
    });
    return next();
  });

  app.use('/auth', authRouter);
  app.use('/profile', profileRouter);
  app.use('/media', mediaRouter);
  app.use('/matching', matchingRouter);
  app.use('/reports', reportsRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/pro', proRouter);
  app.use('/consent', consentRouter);
  app.use('/analytics', analyticsRouter);
  app.use('/blobosphere', blobospherePublicRouter);
  app.use('/public/pros', proPublicRouter);
  app.use('/admin', adminRouter);
  app.use('/admin/blobosphere', blobosphereAdminRouter);
  app.use('/security', securityRouter);
  app.use('/contact', contactRouter);
  app.use('/push', pushRouter);
  app.use('/notifications', notificationsRouter);


  // Internal metrics endpoint — token auth, never logs the provided value.
  // Returns a point-in-time snapshot of:
  //   - process runtime (uptime, memory — process-level, NOT VPS/container-level)
  //   - http: global request counters + latency percentiles (excludes monitoring probes)
  //   - matching: search/decisions counters (matching module only)
  //   - log_transport: pipeline state (queue, sent, dropped, breaker)
  // All values are process-lifetime counters — they reset on process restart.
  // No PII, no secrets, no per-user data in this response.
  app.get('/internal/metrics', (req: Request, res: Response) => {
    const expected = process.env.METRICS_INTERNAL_TOKEN;
    const provided = req.headers['x-internal-token'] as string | undefined;
    const ipHash = getRequestIpHash(req);

    if (!expected || !provided) {
      secureLogger.warn('METRICS_INTERNAL_TOKEN_REJECTED', { ipHash });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Timing-safe compare — consistent with security.access.ts
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      secureLogger.warn('METRICS_INTERNAL_TOKEN_REJECTED', { ipHash });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    secureLogger.info('METRICS_INTERNAL_TOKEN_ACCESS', { ipHash });

    const mem = process.memoryUsage();
    return res.json({
      timestamp: new Date().toISOString(),
      // process.uptime() and memoryUsage() reflect this Node.js process only.
      // They do NOT represent VPS CPU%, system memory, disk or container limits.
      process: {
        uptime_s: Math.floor(process.uptime()),
        memory_rss_mb: Math.round(mem.rss / 1024 / 1024),
        memory_heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        memory_heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      http: getHttpMetricsSnapshot(),
      email: getEmailMetricsSnapshot(),
      matching: getMatchingMetricsSnapshot(),
      log_transport: getLogTransportMetrics(),
    });
  });

  // Global error handler
  app.use(globalErrorHandler);

  return app;
}

export const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    res.status(413).json({ error: 'Payload too large' });
    return;
  }
  secureLogger.error('GLOBAL_ERROR_HANDLER_TRIGGERED', {
    error: err,
    method: req?.method,
    path: req?.path,
  });
  res.status(500).json({ error: 'Internal server error' });
};

if (process.env.NODE_ENV !== 'test') {
  // Attendre que Redis soit connecté avant de créer l'app et d'écouter.
  // En production : redis-client.ts appelle process.exit(1) si Redis échoue,
  // donc la promesse ne résout que si Redis est disponible.
  // En dev : la promesse résout après 5s max (timeout + memory fallback accepté).
  registerLogTransportShutdownHandlers();

  redisClientInitPromise.then(() => {
    const port = process.env.PORT ? Number(process.env.PORT) : 4000;

    // createApp() est appelé APRÈS Redis init : buildSessionStore() retourne RedisStore.
    const app = createApp();

    // Create HTTP server for both Express and Socket.io
    const httpServer = createServer(app);

    // Initialize Socket.io
    const { initializeSocket } = require('./lib/socket');
    initializeSocket(httpServer);

    // Load 2FA Lua script into Redis for EVALSHA optimization
    // This improves 2FA verification performance by ~30%
    import('./services/two-factor.service.js').then(({ loadLuaScript }) => {
      loadLuaScript().catch((error: unknown) => {
        secureLogger.error('STARTUP_LUA_SCRIPT_LOAD_FAILED', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }).catch((error: unknown) => {
      secureLogger.error('STARTUP_LUA_SCRIPT_IMPORT_FAILED', {
        error: error instanceof Error ? error.message : String(error)
      });
    });

    httpServer.listen(port, () => {
      secureLogger.info('API_SERVER_READY', {
        port,
        env: process.env.NODE_ENV ?? 'development',
      });
      secureLogger.info('WEBSOCKET_SERVER_READY', { port });
    });
  }).catch((error: unknown) => {
    secureLogger.error('STARTUP_REDIS_INIT_FAILED', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
