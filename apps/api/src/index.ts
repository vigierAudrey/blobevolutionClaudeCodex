import dotenv from 'dotenv';
import { resolve } from 'path';
// Load env from repo root by default so workspaces share one .env
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
// Minimal CORS middleware to avoid ESM/CJS interop issues in dev
function simpleCors(_req: any, res: any, next: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-XSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
import helmet from 'helmet';
import { setupCSRF, csrfProtection, getCSRFToken } from './middleware/csrf';
import { smartRateLimit } from './middleware/enhanced-rate-limit';
import { authRouter } from './modules/auth/auth.controller';
import { profileRouter } from './modules/profile/profile.controller';
import { matchingRouter } from './modules/matching/matching.controller';
import { reportsRouter } from './modules/reports/reports.controller';
import { conversationsRouter } from './modules/chat/conversations.controller';
import { proRouter } from './modules/pro/pro.controller';
import { creditsRouter } from './modules/credits/credits.controller';
import { adminRouter } from './modules/admin/admin.controller';
import { contactRouter } from './modules/contact/contact.controller';
import { bookingRouter } from './modules/booking/booking.controller';
import pushRouter from './modules/push/push.controller';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Trust proxy configuration - more secure than 'true'
  // In dev, trust localhost. In prod, trust only known proxy IPs or use number of hops
  if (process.env.NODE_ENV === 'production') {
    // Production: trust first proxy or specific IPs
    const trustedProxies = process.env.TRUSTED_PROXY_IPS?.split(',') || ['127.0.0.1', '::1'];
    app.set('trust proxy', trustedProxies);
  } else {
    // Development: trust localhost and private networks
    app.set('trust proxy', ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
  }

  // Session configuration for CSRF
  app.use(session({
    secret: process.env.SESSION_SECRET || 'blobinfini-dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
    }
  }));

  app.use(simpleCors);
  app.use(helmet());

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
      const { prisma } = await import('@blobinfini/database');
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
      const { gdprPurgeService } = await import('./services/gdpr-purge.service');
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
      const { prisma } = await import('@blobinfini/database');
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

  // Apply CSRF protection to all routes
  app.use(csrfProtection);

  app.use('/auth', authRouter);
  app.use('/profile', profileRouter);
  app.use('/matching', matchingRouter);
  app.use('/reports', reportsRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/pro', proRouter);
  app.use('/credits', creditsRouter);
  app.use('/admin', adminRouter);
  app.use('/contact', contactRouter);
  app.use('/booking', bookingRouter);
  app.use('/push', pushRouter);

  return app;
}

const app = createApp();

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
  });
}

export default app;
