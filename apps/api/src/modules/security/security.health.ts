import { Prisma } from '@blobinfini/database';
import { clientPrisma as prisma } from '@blobinfini/database';
import { cacheService } from '../../services/cache.service';
import {
  resolveSecurityHealthStatus,
  type SecurityHealthChecks,
  type SecurityHealthResponse,
} from './security.contract';

const MIN_SECRET_LENGTH = 64;
const REQUIRED_SECRETS = ['SESSION_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;
const MIN_LOG_ACTOR_SECRET_LENGTH = 32;

function resolveConfigCheck(): 'ok' | 'fail' {
  const isProduction = process.env.NODE_ENV === 'production';
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

export async function buildSecurityHealthResponse(): Promise<SecurityHealthResponse> {
  const checks: SecurityHealthChecks = {
    config: resolveConfigCheck(),
    env: resolveEnvCheck(),
    db: await resolveDbCheck(),
    redis: await resolveRedisCheck(),
  };

  return {
    status: resolveSecurityHealthStatus(checks),
    timestamp: new Date().toISOString(),
    checks,
  };
}
