import './config/loadEnv';
import { resolve } from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { createServer } from 'http';

// Initialize Sentry BEFORE any other imports (must be after dotenv)
import './instrument';

// Standard logging for monitoring (Clever Cloud logs)
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import YAML from 'js-yaml';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { secureLogger } from './utils/secure-logger';

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
import { adminRouter } from './modules/admin/admin.controller';
import { securityRouter } from './modules/security/security.controller';
import { blobosphereAdminRouter } from './modules/blobosphere/blobosphere.controller';
import { blobospherePublicRouter } from './modules/blobosphere/blobosphere.public';
import { contactRouter } from './modules/contact/contact.controller';
import { bookingRouter } from './modules/booking/booking.controller';
import pushRouter from './modules/push/push.controller';
import { requireAuth, requireAdmin, requireVerifiedEmail } from './modules/auth/auth.guard';
import { consentRouter } from './modules/consent/consent.controller';
import { analyticsRouter } from './modules/analytics/analytics.controller';


const OPENAPI_SPEC_PATH = resolve(process.cwd(), 'docs/openapi/openapi.yaml');

const loadOpenApiDocument = () => {
  try {
    const raw = fs.readFileSync(OPENAPI_SPEC_PATH, 'utf-8');
    return YAML.load(raw) as object;
  } catch (error) {
    console.warn('⚠️  Impossible de charger docs/openapi/openapi.yaml', error);
    return null;
  }
};

export function createApp() {
  const app = express();

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
  app.use(express.json());
  app.use(cookieParser());

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
    console.warn('⚠️  WARNING: Using development SESSION_SECRET - DO NOT USE IN PRODUCTION');
    return 'blobinfini-dev-secret-change-in-production';
  })();

  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
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

  // Global rate limiting (before specific routes)
  app.use(smartRateLimit);

  // CSRF setup (must be after session and before routes)
  app.use(setupCSRF);

  // Enhanced GDPR purge system with legal protection
  const gdprPurgeHours = Number(process.env.GDPR_PURGE_INTERVAL_HOURS || '24'); // Daily by default
  const legacyPurgeHours = Number(process.env.CONSENT_PURGE_INTERVAL_HOURS || '0'); // Legacy system
  const purgeDays = Number(process.env.CONSENT_PURGE_RETENTION_DAYS || '730');
  const convPurgeHours = Number(process.env.CONV_PURGE_INTERVAL_HOURS || '0');
  const convTrashDays = Number(process.env.CONV_TRASH_RETENTION_DAYS || '30');
  async function purgeOnce() {
    try {
      const threshold = new Date(Date.now() - purgeDays * 24 * 60 * 60 * 1000);
      const { clientPrisma: prisma } = await import('@blobinfini/database');
      await prisma.user.updateMany({
        where: { consentIp: { not: null }, consentedAt: { lt: threshold } },
        data: { consentIp: null },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Consent purge failed', e);
    }
  }
  // Enhanced GDPR purge system
  async function performGDPRPurge() {
    try {
      const { gdprPurgeService } = await import('./services/gdpr-purge.service.js');
      await gdprPurgeService.performFullPurge();
    } catch (e) {
      console.error('GDPR purge failed', e);
    }
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
  }

  // Background auto-deletion of trashed conversations (per member)
  async function purgeTrashedConversations() {
    try {
      const cutoff = new Date(Date.now() - convTrashDays * 24 * 60 * 60 * 1000);
      const { clientPrisma: prisma } = await import('@blobinfini/database');
      // Remove memberships older than cutoff
      await prisma.conversationMember.deleteMany({ where: { trashedAt: { not: null, lt: cutoff } } });
      // Remove orphan conversations (no members)
      await prisma.conversation.deleteMany({ where: { members: { none: {} } } });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Conversation purge failed', e);
    }
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // CSRF token endpoint (GET requests are not protected)
  app.get('/csrf-token', getCSRFToken);

  app.get('/security/health', requireAuth, requireVerifiedEmail, requireAdmin, (req, res) => {
    // P2-6: Logger qui accède à cet endpoint sensible
    secureLogger.security('SECURITY_HEALTH_CHECK_ACCESSED', {
      adminId: (req as any).user?.id,
      ip: req.ip
    });

    const issues: string[] = [];
    const isProd = process.env.NODE_ENV === 'production';

    const proxies = process.env.TRUSTED_PROXY_IPS?.split(',').map(v => v.trim()).filter(Boolean) || [];

    if (isProd) {
      if (allowedOriginsSet.size === 0) {
        issues.push('ALLOWED_ORIGINS is empty');
      }
      if (proxies.length === 0) {
        issues.push('TRUSTED_PROXY_IPS missing');
      }
    }

    const authRequireVerified = String(
      process.env.AUTH_REQUIRE_VERIFIED ?? (isProd ? 'true' : 'false')
    ).toLowerCase() === 'true';

    if (isProd && !authRequireVerified) {
      issues.push('AUTH_REQUIRE_VERIFIED is not true in production');
    }

    // P2-6: Mode verbose pour détails (seulement si SECURITY_HEALTH_VERBOSE=true)
    const verbose = process.env.SECURITY_HEALTH_VERBOSE === 'true';

    const result = {
      status: issues.length ? 'VULNERABLE' : 'SECURE',
      helmet: true,
      csrf: true,
      rateLimit: true,
      corsWhitelist: verbose ? Array.from(allowedOriginsSet) : allowedOriginsSet.size, // P2-6: Ne pas exposer les origins en mode normal
      authRequireVerified,
      issuesCount: issues.length,
      issues: verbose ? issues : undefined, // P2-6: Détails uniquement en mode verbose
      checks: {
        corsConfigured: allowedOriginsSet.size > 0,
        trustedProxyConfigured: proxies.length > 0,
        authRequireVerified: authRequireVerified || !isProd
      }
    };

    res.status(issues.length ? 503 : 200).json(result);
  });

  // OpenAPI specification & Swagger UI
  app.get('/openapi.yaml', (_req, res) => {
    res.sendFile(OPENAPI_SPEC_PATH);
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
      customSiteTitle: 'BlobConnect API – Swagger UI',
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

  // Simple request logging for debugging (P2-9: Use secureLogger to prevent logging sensitive query params)
  app.use((req, _res, next) => {
    secureLogger.info('HTTP_REQUEST', {
      method: req.method,
      path: req.path, // Path only (no query params)
      // Query params are automatically redacted by secureLogger if they contain sensitive keys
    });
    next();
  });

  app.use('/auth', authRouter);
  app.use('/profile', profileRouter);
  app.use('/matching', matchingRouter);
  app.use('/reports', reportsRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/pro', proRouter);
  app.use('/consent', consentRouter);
  app.use('/analytics', analyticsRouter);
  app.use('/blobosphere', blobospherePublicRouter);
  app.use('/admin', adminRouter);
  app.use('/admin/blobosphere', blobosphereAdminRouter);
  app.use('/security', securityRouter);
  // Back-compat alias for tests and clients using '/api/security/*'
  app.use('/api/security', securityRouter);
  app.use('/contact', contactRouter);
  app.use('/booking', bookingRouter);
  app.use('/push', pushRouter);


  // Global error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('Global error handler:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const app = createApp();

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;

  // Create HTTP server for both Express and Socket.io
  const httpServer = createServer(app);

  // Initialize Socket.io
  const { initializeSocket } = require('./lib/socket');
  initializeSocket(httpServer);

  httpServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.info(`[API] Server ready on http://localhost:${port} (env=${process.env.NODE_ENV ?? 'development'})`);
    // eslint-disable-next-line no-console
    console.info(`[WebSocket] Socket.io ready on ws://localhost:${port}`);
  });
}

export default app;
