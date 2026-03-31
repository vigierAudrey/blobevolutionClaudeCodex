/**
 * Environment variable validation for production safety.
 *
 * This module ensures critical environment variables are properly set
 * before the application starts. Prevents deployment with insecure defaults.
 */

import { isTrustProxyConfigSafe, getTrustProxyMode } from './client-ip';
import { secureLogger } from '../utils/secure-logger';

const INSECURE_DEFAULTS = {
  REDIS_PASSWORD: ['change-me-strong', 'change-me'],
  TWO_FACTOR_SECRET: ['change-me-2fa-secret-production', 'change-me'],
  IP_HASH_SECRET: ['change-me-strong-ip-hash-secret-production-min-32-chars', 'change-me'],
  LOG_ACTOR_SECRET: ['blobinfini-dev-log-actor-secret', 'change-me'],
  JWT_SECRET: ['please-change-in-dev', 'change-me', 'secret'],
  JWT_REFRESH_SECRET: ['please-change-in-dev-refresh', 'change-me', 'secret'],
};

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') {
    secureLogger.info('ENV_VALIDATION_SKIPPED', { env: process.env.NODE_ENV ?? 'undefined' });
    return;
  }

  secureLogger.info('ENV_VALIDATION_STARTED');

  const errors: string[] = [];

  // Check for insecure defaults
  for (const [key, insecureValues] of Object.entries(INSECURE_DEFAULTS)) {
    const value = process.env[key];

    if (!value) {
      errors.push(`${key} is not set`);
      continue;
    }

    if (insecureValues.includes(value)) {
      errors.push(`${key} is set to insecure default value "${value}"`);
    }
  }

  // Check REDIS_URL format
  if (!process.env.REDIS_URL) {
    errors.push('REDIS_URL is not set');
  } else if (!process.env.REDIS_URL.startsWith('redis://')) {
    errors.push('REDIS_URL must start with redis://');
  }

  // Check DATABASE_URL SSL in production
  // Exception pré-VPS / VPS : réseau Docker interne, SSL entre containers non nécessaire.
  // APP_ENV=pre-vps ou APP_ENV=vps doit être défini explicitement — jamais en production cloud/managed.
  const isPreVps = process.env.APP_ENV === 'pre-vps' || process.env.APP_ENV === 'vps';
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set');
  } else if (
    !isPreVps &&
    !process.env.DATABASE_URL.includes('sslmode=require') &&
    !process.env.DATABASE_URL.includes('sslmode=verify-full')
  ) {
    errors.push('DATABASE_URL must include sslmode=require or sslmode=verify-full in production');
  }

  if (String(process.env.RATE_LIMIT_DISABLED_FOR_BOOKING_REQUESTS ?? '').toLowerCase() === 'true') {
    errors.push('RATE_LIMIT_DISABLED_FOR_BOOKING_REQUESTS=true is NOT allowed in production');
  }

  const primaryAdminEmailsRaw = String(process.env.PRIMARY_ADMIN_EMAILS ?? '').trim();
  if (!primaryAdminEmailsRaw) {
    errors.push('PRIMARY_ADMIN_EMAILS is required in production and must not be empty');
  } else {
    const primaryAdminEmails = primaryAdminEmailsRaw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    if (primaryAdminEmails.length === 0) {
      errors.push('PRIMARY_ADMIN_EMAILS must contain at least one valid email in production');
    }

    // Exception pré-VPS : email admin local toléré.
    if (!isPreVps && primaryAdminEmails.includes('dev+admin@test.com')) {
      errors.push('PRIMARY_ADMIN_EMAILS must not include dev+admin@test.com in production');
    }
  }

  // Exception pré-VPS UNIQUEMENT : 2FA peut être désactivé pour les smoke-tests sans TOTP.
  // VPS qualifié (APP_ENV=vps) exige AUTH_REQUIRE_2FA=true — pas d'exemption.
  const isPreVpsOnly = process.env.APP_ENV === 'pre-vps';
  const authRequire2FA = String(process.env.AUTH_REQUIRE_2FA ?? '').trim().toLowerCase();
  if (!isPreVpsOnly && (authRequire2FA === 'false' || authRequire2FA === '0')) {
    errors.push('AUTH_REQUIRE_2FA=false is NOT allowed in production or VPS');
  }

  const loginAttemptStorePlaintextEmail = String(process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(loginAttemptStorePlaintextEmail)) {
    errors.push('LOGINATTEMPT_STORE_PLAINTEXT_EMAIL=true is NOT allowed in production');
  }

  const truthyValues = new Set(['1', 'true', 'yes', 'on']);
  const testAdminProvisionFlags = Object.entries(process.env)
    .filter(([key]) => /test.*admin.*provision|admin.*test.*provision/i.test(key))
    .filter(([, value]) => truthyValues.has(String(value ?? '').trim().toLowerCase()));
  for (const [flagName] of testAdminProvisionFlags) {
    errors.push(`${flagName} is NOT allowed in production`);
  }

  // Validate trust proxy configuration
  const trustProxyMode = getTrustProxyMode();
  if (!isTrustProxyConfigSafe()) {
    if (trustProxyMode === 'true') {
      errors.push('TRUST_PROXY_MODE="true" is UNSAFE in production (allows IP spoofing). Use "ips" or "loopback" instead.');
    } else if (trustProxyMode === 'ips' && !process.env.TRUSTED_PROXY_IPS) {
      errors.push('TRUST_PROXY_MODE="ips" requires TRUSTED_PROXY_IPS to be set');
    }
  }

  // Warn if trust proxy mode is not set (safe but may be unintentional)
  if (!process.env.TRUST_PROXY_MODE) {
    secureLogger.warn('TRUST_PROXY_MODE_UNSET');
  }

  // Validate IP_HASH_SECRET is different from TWO_FACTOR_SECRET (security isolation)
  if (process.env.IP_HASH_SECRET && process.env.TWO_FACTOR_SECRET) {
    if (process.env.IP_HASH_SECRET === process.env.TWO_FACTOR_SECRET) {
      errors.push('IP_HASH_SECRET must be different from TWO_FACTOR_SECRET (security isolation)');
    }
  }

  if (process.env.LOG_ACTOR_SECRET && process.env.JWT_SECRET) {
    if (process.env.LOG_ACTOR_SECRET === process.env.JWT_SECRET) {
      errors.push('LOG_ACTOR_SECRET must be different from JWT_SECRET (dedicated log pseudonymization secret)');
    }
  }

  // NEW-P2-3: S3 strict validation — all four credentials required, no empty/default values
  const S3_REQUIRED = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  for (const key of S3_REQUIRED) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      errors.push(`${key} is required in production but is not set or empty`);
    }
  }
  // Exception pré-VPS : MinIO avec credentials non-minioadmin mais non-prod autorisé.
  if (!isPreVps && process.env.S3_ACCESS_KEY_ID === 'minioadmin') {
    errors.push('S3_ACCESS_KEY_ID must not use the default "minioadmin" value in production');
  }
  if (!isPreVps && process.env.S3_SECRET_ACCESS_KEY === 'minioadmin') {
    errors.push('S3_SECRET_ACCESS_KEY must not use the default "minioadmin" value in production');
  }

  // S3_PRESIGN_ENDPOINT et S3_PUBLIC_URL_BASE : ne doivent jamais pointer vers un hôte interne
  // (seulement en production non-VPS — en VPS ces vars sont injectées par docker-compose)
  if (!isPreVps) {
    for (const key of ['S3_PRESIGN_ENDPOINT', 'S3_PUBLIC_URL_BASE'] as const) {
      const val = process.env[key];
      if (val) {
        if (!val.startsWith('https://')) {
          errors.push(`${key} must start with https:// in production (current: ${val})`);
        }
        if (/localhost|127\.0\.0\.\d|minio[:/]|::1/.test(val)) {
          errors.push(`${key} must not reference an internal host (current: ${val})`);
        }
      }
    }
  }

  // Admin refresh TTL : interdire >24h en production (valeur par défaut = 8h dans auth.service.ts)
  const adminRefreshTtlRaw = process.env.ADMIN_REFRESH_TTL_HOURS;
  if (adminRefreshTtlRaw !== undefined) {
    const ttlHours = parseInt(adminRefreshTtlRaw, 10);
    if (isNaN(ttlHours) || ttlHours < 1) {
      errors.push('ADMIN_REFRESH_TTL_HOURS must be a positive integer (hours)');
    } else if (ttlHours > 24) {
      errors.push('ADMIN_REFRESH_TTL_HOURS must be ≤24h in production (recommended: 8)');
    }
  }

  // COOKIE_DOMAIN requis en prod (fail-fast).
  // Architecture : API (api.blobinfini.app) ≠ frontend Vercel (blobinfini.app).
  // Sans COOKIE_DOMAIN=.blobinfini.app, le cookie admin_session posé par l'API
  // est scopé à api.blobinfini.app et invisible du middleware Next.js → panne admin totale.
  // Exception pré-VPS : tout tourne sur le même host via Docker nginx, même domaine.
  if (!isPreVps) {
    if (!process.env.COOKIE_DOMAIN) {
      errors.push(
        'COOKIE_DOMAIN is required in production (e.g. ".blobinfini.app"). ' +
        'Without it, admin_session cookie is scoped to the API domain only and invisible to the Next.js middleware, ' +
        'causing a complete admin login outage.'
      );
    } else if (!process.env.COOKIE_DOMAIN.startsWith('.')) {
      errors.push('COOKIE_DOMAIN must start with "." to cover all subdomains (e.g. ".blobinfini.app")');
    }
  }

  // TRUSTED_IPS : interdire les wildcards qui désactivent tout rate limiting
  if (process.env.TRUSTED_IPS) {
    const trustedEntries = process.env.TRUSTED_IPS.split(',').map((e) => e.trim());
    const wildcards = ['0.0.0.0', '0.0.0.0/0', '::', '::/0', '::0/0'];
    for (const entry of trustedEntries) {
      if (wildcards.includes(entry)) {
        errors.push(`TRUSTED_IPS must not contain wildcard entry "${entry}" (disables all rate limiting)`);
      }
    }
  }

  if (errors.length > 0) {
    secureLogger.error('ENV_VALIDATION_FAILED', { errors });
    process.exit(1);
  }

  secureLogger.info('ENV_VALIDATION_SUCCEEDED');
}
