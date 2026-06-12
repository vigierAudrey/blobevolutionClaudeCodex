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
  EMAIL_HASH_SECRET: ['change-me-strong-email-hash-secret-production-min-32-chars', 'change-me'],
  LOG_ACTOR_SECRET: ['blobinfini-dev-log-actor-secret', 'change-me'],
  JWT_SECRET: ['please-change-in-dev', 'change-me', 'secret'],
  JWT_REFRESH_SECRET: ['please-change-in-dev-refresh', 'change-me', 'secret'],
};
const BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
const LOCAL_SMTP_HOSTS = new Set(['mailpit', 'localhost', '127.0.0.1']);

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') {
    secureLogger.info('ENV_VALIDATION_SKIPPED', { env: process.env.NODE_ENV ?? 'undefined' });
    return;
  }

  secureLogger.info('ENV_VALIDATION_STARTED');

  const errors: string[] = [];

  // Check for insecure defaults
  for (const [key, insecureValues] of Object.entries(INSECURE_DEFAULTS)) {
    const rawValue = process.env[key];
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';

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
  const appEnv = process.env.APP_ENV;
  const isVps = appEnv === 'vps';
  const isPreVps = appEnv === 'pre-vps' || isVps;
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

  if (isVps) {
    const smtpHost = String(process.env.SMTP_HOST ?? '').trim().toLowerCase();
    const smtpPort = String(process.env.SMTP_PORT ?? '').trim();
    const smtpUser = String(process.env.SMTP_USER ?? '').trim();
    const smtpPass = String(process.env.SMTP_PASS ?? '').trim();
    const smtpFrom = String(process.env.SMTP_FROM ?? '').trim();
    const smtpSecure = String(process.env.SMTP_SECURE ?? '').trim().toLowerCase();
    const smtpAllowNoAuth = String(process.env.SMTP_ALLOW_NO_AUTH ?? '').trim().toLowerCase();

    if (!smtpHost) {
      errors.push('SMTP_HOST is required when APP_ENV=vps');
    } else {
      if (LOCAL_SMTP_HOSTS.has(smtpHost)) {
        errors.push(`SMTP_HOST="${smtpHost}" is forbidden when APP_ENV=vps`);
      }
      if (smtpHost !== BREVO_SMTP_HOST) {
        errors.push(`SMTP_HOST must be "${BREVO_SMTP_HOST}" when APP_ENV=vps`);
      }
    }

    if (!['465', '587'].includes(smtpPort)) {
      errors.push('SMTP_PORT must be 465 or 587 when APP_ENV=vps');
    }
    if (!smtpUser) {
      errors.push('SMTP_USER is required when APP_ENV=vps');
    }
    if (!smtpPass) {
      errors.push('SMTP_PASS is required when APP_ENV=vps');
    }
    if (!smtpFrom) {
      errors.push('SMTP_FROM is required when APP_ENV=vps');
    }
    if (!['true', 'false'].includes(smtpSecure)) {
      errors.push('SMTP_SECURE must be explicitly set to true or false when APP_ENV=vps');
    } else if (
      (smtpPort === '465' && smtpSecure !== 'true') ||
      (smtpPort === '587' && smtpSecure !== 'false')
    ) {
      errors.push('SMTP_SECURE must match SMTP_PORT policy (465=true, 587=false) when APP_ENV=vps');
    }
    if (['1', 'true', 'yes', 'on'].includes(smtpAllowNoAuth)) {
      errors.push('SMTP_ALLOW_NO_AUTH=true is forbidden when APP_ENV=vps');
    }
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
  const ipHashSecret = process.env.IP_HASH_SECRET?.trim();
  const twoFactorSecret = process.env.TWO_FACTOR_SECRET?.trim();
  const emailHashSecret = process.env.EMAIL_HASH_SECRET?.trim();

  if (ipHashSecret && twoFactorSecret) {
    if (ipHashSecret === twoFactorSecret) {
      errors.push('IP_HASH_SECRET must be different from TWO_FACTOR_SECRET (security isolation)');
    }
  }

  // Validate EMAIL_HASH_SECRET is different from IP_HASH_SECRET (security isolation)
  if (emailHashSecret && ipHashSecret) {
    if (emailHashSecret === ipHashSecret) {
      errors.push('EMAIL_HASH_SECRET must be different from IP_HASH_SECRET (security isolation)');
    }
  }

  if (process.env.LOG_ACTOR_SECRET && process.env.JWT_SECRET) {
    if (process.env.LOG_ACTOR_SECRET === process.env.JWT_SECRET) {
      errors.push('LOG_ACTOR_SECRET must be different from JWT_SECRET (dedicated log pseudonymization secret)');
    }
  }

  // NEW-P2-3: S3 strict validation — all four credentials required, no empty/default values
  const S3_REQUIRED = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL_BASE'] as const;
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
  // Architecture : API (api.blobsurf.com) ≠ frontend (blobsurf.com).
  // Sans COOKIE_DOMAIN=.blobsurf.com, le cookie admin_session posé par l'API
  // est scopé à api.blobsurf.com et invisible du middleware Next.js → panne admin totale.
  // Exception pré-VPS : tout tourne sur le même host via Docker nginx, même domaine.
  if (!isPreVps) {
    if (!process.env.COOKIE_DOMAIN) {
      errors.push(
        'COOKIE_DOMAIN is required in production (e.g. ".blobsurf.com"). ' +
        'Without it, admin_session cookie is scoped to the API domain only and invisible to the Next.js middleware, ' +
        'causing a complete admin login outage.'
      );
    } else if (!process.env.COOKIE_DOMAIN.startsWith('.')) {
      errors.push('COOKIE_DOMAIN must start with "." to cover all subdomains (e.g. ".blobsurf.com")');
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

/**
 * Validation légère des variables de configuration LOT 4 brute-force.
 * WARN uniquement — jamais de fail-fast (variables opérationnelles, non sensibles).
 * Defaults sûrs définis dans brute-force-detector.ts (email=5, ip=20, ttl=86400).
 *
 * Appelé au démarrage dans index.ts, tous environments confondus.
 */
export function validateBruteForceEnv(): void {
  // Seuil email : en dessous de 3, risque de DoS (utilisateurs légitimes flagués)
  const emailThresholdRaw = process.env.BF_EMAIL_THRESHOLD;
  if (emailThresholdRaw !== undefined) {
    const val = Number(emailThresholdRaw);
    if (isNaN(val) || val < 3) {
      secureLogger.warn('BF_CONFIG_EMAIL_THRESHOLD_LOW', {
        value: emailThresholdRaw,
        minimum: 3,
        impact: 'Low threshold increases DoS risk — legitimate users could be flagged suspect',
      });
    }
  }

  // Seuil IP : en dessous de 5, risque de faux positifs sur IP NAT partagées
  const ipThresholdRaw = process.env.BF_IP_THRESHOLD;
  if (ipThresholdRaw !== undefined) {
    const val = Number(ipThresholdRaw);
    if (isNaN(val) || val < 5) {
      secureLogger.warn('BF_CONFIG_IP_THRESHOLD_LOW', {
        value: ipThresholdRaw,
        minimum: 5,
        impact: 'Low threshold may flag NAT/shared IPs as suspicious',
      });
    }
  }

  // TTL email : en dessous de 300s (5min), la fenêtre ne couvre pas une attaque lente
  const emailTtlRaw = process.env.BF_EMAIL_TTL_SECONDS;
  if (emailTtlRaw !== undefined) {
    const val = Number(emailTtlRaw);
    if (isNaN(val) || val < 300) {
      secureLogger.warn('BF_CONFIG_EMAIL_TTL_TOO_SHORT', {
        value: emailTtlRaw,
        minimum: 300,
        impact: 'Short TTL reduces detection window — slow attackers may go undetected',
      });
    }
  }

  // TTL IP : idem
  const ipTtlRaw = process.env.BF_IP_TTL_SECONDS;
  if (ipTtlRaw !== undefined) {
    const val = Number(ipTtlRaw);
    if (isNaN(val) || val < 300) {
      secureLogger.warn('BF_CONFIG_IP_TTL_TOO_SHORT', {
        value: ipTtlRaw,
        minimum: 300,
        impact: 'Short TTL reduces detection window — slow attackers may go undetected',
      });
    }
  }
}

/**
 * Validation légère du cache admin /admin/stats.
 * WARN uniquement — jamais de fail-fast.
 * Defaults sûrs appliqués côté runtime : enabled=true, ttl=120s.
 */
export function validateAdminStatsCacheEnv(): void {
  const enabledRaw = process.env.ADMIN_STATS_CACHE_ENABLED;
  if (enabledRaw !== undefined) {
    const normalized = enabledRaw.trim().toLowerCase();
    if (!['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off'].includes(normalized)) {
      secureLogger.warn('ADMIN_STATS_CACHE_ENABLED_INVALID', {
        value: enabledRaw,
        defaultApplied: true,
      });
    }
  }

  const ttlRaw = process.env.ADMIN_STATS_CACHE_TTL_SECONDS;
  if (ttlRaw !== undefined) {
    const ttl = Number.parseInt(ttlRaw, 10);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      secureLogger.warn('ADMIN_STATS_CACHE_TTL_INVALID', {
        value: ttlRaw,
        defaultApplied: 120,
      });
    }
  }
}
