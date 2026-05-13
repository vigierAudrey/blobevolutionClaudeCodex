import { Prisma } from '@blobinfini/database';
import { clientPrisma as prisma } from '@blobinfini/database';
import { verifySmtpConnection } from '../../lib/mailer';
import { cacheService } from '../../services/cache.service';
import {
  resolveSecurityHealthStatus,
  type SecurityHealthChecks,
  type SecurityHealthResponse,
} from './security.contract';

const MIN_SECRET_LENGTH = 64;
const REQUIRED_SECRETS = ['SESSION_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;
const MIN_LOG_ACTOR_SECRET_LENGTH = 32;
const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);
const truthyValues = new Set(['1', 'true', 'yes', 'on']);

function resolveConfigCheck(): 'ok' | 'fail' {
  const isProduction = process.env.NODE_ENV === 'production';
  const isVps = process.env.APP_ENV === 'vps';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const trustedProxies = (process.env.TRUSTED_PROXY_IPS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const authRequireVerified = String(
    process.env.AUTH_REQUIRE_VERIFIED ?? (isProduction ? 'true' : 'false'),
  ).toLowerCase() === 'true';
  const monitorTokenConfigured = Boolean(process.env.SECURITY_MONITOR_TOKEN?.trim());

  if (!isProduction) {
    return 'ok';
  }

  if (allowedOrigins.length === 0 || trustedProxies.length === 0) {
    return 'fail';
  }

  if (!authRequireVerified || !monitorTokenConfigured) {
    return 'fail';
  }

  if (isVps) {
    const smtpHost = String(process.env.SMTP_HOST ?? '').trim().toLowerCase();
    const smtpPort = String(process.env.SMTP_PORT ?? '').trim();
    const smtpUser = String(process.env.SMTP_USER ?? '').trim();
    const smtpPass = String(process.env.SMTP_PASS ?? '').trim();
    const smtpFrom = String(process.env.SMTP_FROM ?? '').trim();
    const smtpAllowNoAuth = String(process.env.SMTP_ALLOW_NO_AUTH ?? '').trim().toLowerCase();

    if (
      !smtpHost ||
      LOCAL_SMTP_HOSTS.has(smtpHost) ||
      smtpHost !== BREVO_SMTP_HOST ||
      !['465', '587'].includes(smtpPort) ||
      !smtpUser ||
      !smtpPass ||
      !smtpFrom ||
      ['1', 'true', 'yes', 'on'].includes(smtpAllowNoAuth)
    ) {
      return 'fail';
    }
  }

  return 'ok';
}

function resolveEnvCheck(): 'ok' | 'fail' {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    return 'ok';
  }

  const weakSecrets = REQUIRED_SECRETS.some((key) => {
    const value = process.env[key];
    return !value || value.length < MIN_SECRET_LENGTH;
  });

  if (weakSecrets) {
    return 'fail';
  }

  const logActorSecret = process.env.LOG_ACTOR_SECRET;
  return logActorSecret && logActorSecret.length >= MIN_LOG_ACTOR_SECRET_LENGTH ? 'ok' : 'fail';
}

async function resolveDbCheck(): Promise<'ok' | 'fail'> {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    return 'ok';
  } catch {
    return 'fail';
  }
}

async function resolveRedisCheck(): Promise<'ok' | 'fail'> {
  try {
    const health = await cacheService.healthCheck();
    return health.status === 'healthy' ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

async function resolveSmtpCheck(): Promise<'ok' | 'fail'> {
  const isProduction = process.env.NODE_ENV === 'production';
  const isVps = process.env.APP_ENV === 'vps';

  if (!isProduction || !isVps) {
    return 'ok';
  }

  const smtpHost = String(process.env.SMTP_HOST ?? '').trim().toLowerCase();
  const smtpPort = String(process.env.SMTP_PORT ?? '').trim();
  const smtpUser = String(process.env.SMTP_USER ?? '').trim();
  const smtpPass = String(process.env.SMTP_PASS ?? '').trim();
  const smtpFrom = String(process.env.SMTP_FROM ?? '').trim();
  const smtpSecure = String(process.env.SMTP_SECURE ?? '').trim().toLowerCase();

  if (
    !smtpHost ||
    smtpHost !== BREVO_SMTP_HOST ||
    LOCAL_SMTP_HOSTS.has(smtpHost) ||
    !['465', '587'].includes(smtpPort) ||
    !smtpUser ||
    !smtpPass ||
    !smtpFrom ||
    !['true', 'false'].includes(smtpSecure) ||
    (smtpPort === '465' && smtpSecure !== 'true') ||
    (smtpPort === '587' && smtpSecure !== 'false')
  ) {
    return 'fail';
  }

  if (!truthyValues.has(String(process.env.SMTP_HEALTHCHECK_VERIFY ?? '').trim().toLowerCase())) {
    return 'ok';
  }

  try {
    return await verifySmtpConnection() ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

export async function buildSecurityHealthResponse(): Promise<SecurityHealthResponse> {
  const checks: SecurityHealthChecks = {
    config: resolveConfigCheck(),
    env: resolveEnvCheck(),
    db: await resolveDbCheck(),
    redis: await resolveRedisCheck(),
    smtp: await resolveSmtpCheck(),
  };

  return {
    status: resolveSecurityHealthStatus(checks),
    timestamp: new Date().toISOString(),
    checks,
  };
}
