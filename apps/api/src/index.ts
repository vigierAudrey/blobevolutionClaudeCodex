import dotenv from 'dotenv';
import { resolve } from 'path';
// Load env from repo root by default so workspaces share one .env
dotenv.config({ path: resolve(process.cwd(), process.env.ENV_FILE || '../../.env') });
import express from 'express';
// Minimal CORS middleware to avoid ESM/CJS interop issues in dev
function simpleCors(_req: any, res: any, next: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
import helmet from 'helmet';
import { authRouter } from './modules/auth/auth.controller';
import { profileRouter } from './modules/profile/profile.controller';
import { matchingRouter } from './modules/matching/matching.controller';
import { reportsRouter } from './modules/reports/reports.controller';
import { conversationsRouter } from './modules/chat/conversations.controller';
import { proRouter } from './modules/pro/pro.controller';
import { creditsRouter } from './modules/credits/credits.controller';
import { adminRouter } from './modules/admin/admin.controller';

export function createApp() {
  const app = express();
  app.use(express.json());
  // Trust proxy so req.ip/req.ips reflect X-Forwarded-For when behind a reverse proxy
  // In dev Docker/localhost this is harmless; in prod it ensures correct client IPs.
  app.set('trust proxy', true);
  app.use(simpleCors);
  app.use(helmet());

  // Optional background purge of consent IPs (minimization)
  const purgeHours = Number(process.env.CONSENT_PURGE_INTERVAL_HOURS || '0');
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
  if (purgeHours > 0) {
    setInterval(purgeOnce, purgeHours * 60 * 60 * 1000);
    if (String(process.env.CONSENT_PURGE_RUN_ON_START || 'true').toLowerCase() === 'true') {
      purgeOnce();
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
  if (convPurgeHours > 0) {
    setInterval(purgeTrashedConversations, convPurgeHours * 60 * 60 * 1000);
    purgeTrashedConversations();
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/profile', profileRouter);
  app.use('/matching', matchingRouter);
  app.use('/reports', reportsRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/pro', proRouter);
  app.use('/credits', creditsRouter);
  app.use('/admin', adminRouter);

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
