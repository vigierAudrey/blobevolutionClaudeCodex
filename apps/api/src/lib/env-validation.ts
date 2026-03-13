/**
 * Environment variable validation for production safety.
 *
 * This module ensures critical environment variables are properly set
 * before the application starts. Prevents deployment with insecure defaults.
 */

import { isTrustProxyConfigSafe, getTrustProxyMode } from './client-ip';

const INSECURE_DEFAULTS = {
  REDIS_PASSWORD: ['change-me-strong', 'change-me'],
  TWO_FACTOR_SECRET: ['change-me-2fa-secret-production', 'change-me'],
  IP_HASH_SECRET: ['change-me-strong-ip-hash-secret-production-min-32-chars', 'change-me'],
  JWT_SECRET: ['please-change-in-dev', 'change-me', 'secret'],
  JWT_REFRESH_SECRET: ['please-change-in-dev-refresh', 'change-me', 'secret'],
};

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log('ℹ️ Environment validation skipped (not production)');
    return;
  }

  console.log('🔒 Validating production environment variables...');

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
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set');
  } else if (
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

    if (primaryAdminEmails.includes('dev+admin@test.com')) {
      errors.push('PRIMARY_ADMIN_EMAILS must not include dev+admin@test.com in production');
    }
  }

  const authRequire2FA = String(process.env.AUTH_REQUIRE_2FA ?? '').trim().toLowerCase();
  if (authRequire2FA === 'false' || authRequire2FA === '0') {
    errors.push('AUTH_REQUIRE_2FA=false is NOT allowed in production');
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
    console.warn('⚠️  INFO: TRUST_PROXY_MODE not set, defaulting to "disabled" (safest). Set explicitly if behind reverse proxy.');
  }

  // Validate IP_HASH_SECRET is different from TWO_FACTOR_SECRET (security isolation)
  if (process.env.IP_HASH_SECRET && process.env.TWO_FACTOR_SECRET) {
    if (process.env.IP_HASH_SECRET === process.env.TWO_FACTOR_SECRET) {
      errors.push('IP_HASH_SECRET must be different from TWO_FACTOR_SECRET (security isolation)');
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
  // Forbid minioadmin default credentials in production
  if (process.env.S3_ACCESS_KEY_ID === 'minioadmin') {
    errors.push('S3_ACCESS_KEY_ID must not use the default "minioadmin" value in production');
  }
  if (process.env.S3_SECRET_ACCESS_KEY === 'minioadmin') {
    errors.push('S3_SECRET_ACCESS_KEY must not use the default "minioadmin" value in production');
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
    console.error('\n❌ FATAL: Production environment validation failed:\n');
    errors.forEach((error) => console.error(`   - ${error}`));
    console.error('\n🛑 Application will not start. Fix the above issues and restart.\n');
    process.exit(1);
  }

  console.log('✅ Production environment variables validated successfully');
}
