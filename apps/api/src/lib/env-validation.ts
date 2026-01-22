/**
 * Environment variable validation for production safety.
 *
 * This module ensures critical environment variables are properly set
 * before the application starts. Prevents deployment with insecure defaults.
 */

import { isTrustProxyConfigSafe, getTrustProxyMode } from './client-ip';

const INSECURE_DEFAULTS = {
  TWO_FACTOR_SECRET: ['change-me-2fa-secret-production', 'change-me'],
  IP_HASH_SECRET: ['change-me-strong-ip-hash-secret-production-min-32-chars', 'change-me'],
  JWT_SECRET: ['please-change-in-dev', 'change-me', 'secret'],
  JWT_REFRESH_SECRET: ['please-change-in-dev-refresh', 'change-me', 'secret'],
};

const REDIS_PASSWORD_DEFAULTS = ['change-me-strong', 'change-me'];
const MIN_SECRET_LENGTH = 32;
const MIN_REDIS_PASSWORD_LENGTH = 16;

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log('ℹ️ Environment validation skipped (not production)');
    return;
  }

  console.log('🔒 Validating production environment variables...');

  const errors: string[] = [];

  const allowedOriginsRaw = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = allowedOriginsRaw.map((origin) => origin.replace(/\/+$/, ''));
  if (allowedOrigins.length === 0) {
    errors.push('ALLOWED_ORIGINS is not set');
  } else {
    const invalidScheme = allowedOrigins.some((origin) => !/^https?:\/\//.test(origin));
    if (invalidScheme) {
      errors.push('ALLOWED_ORIGINS must include http(s):// scheme');
    }
    if (process.env.NODE_ENV === 'production') {
      const hasHttp = allowedOrigins.some((origin) => origin.startsWith('http://'));
      if (hasHttp) {
        errors.push('ALLOWED_ORIGINS must use https:// in production');
      }
    }
  }

  const trustedProxyIps = (process.env.TRUSTED_PROXY_IPS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (trustedProxyIps.length === 0) {
    errors.push('TRUSTED_PROXY_IPS is not set');
  }

  // Check for insecure defaults (do not log actual values)
  for (const [key, insecureValues] of Object.entries(INSECURE_DEFAULTS)) {
    const value = process.env[key];

    if (!value) {
      errors.push(`${key} is not set`);
      continue;
    }

    if (insecureValues.includes(value)) {
      errors.push(`${key} is set to an insecure default value`);
    }
  }

  const lengthChecks: Array<[string, string | undefined]> = [
    ['TWO_FACTOR_SECRET', process.env.TWO_FACTOR_SECRET],
    ['IP_HASH_SECRET', process.env.IP_HASH_SECRET],
    ['JWT_SECRET', process.env.JWT_SECRET],
    ['JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET],
  ];

  for (const [key, value] of lengthChecks) {
    if (value && value.length < MIN_SECRET_LENGTH) {
      errors.push(`${key} must be at least ${MIN_SECRET_LENGTH} characters long`);
    }
  }

  // Check REDIS_URL format
  let redisUrlPassword: string | undefined;
  if (!process.env.REDIS_URL) {
    errors.push('REDIS_URL is not set');
  } else {
    try {
      const parsed = new URL(process.env.REDIS_URL);
      if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
        errors.push('REDIS_URL must start with redis:// or rediss://');
      }
      if (parsed.password) {
        redisUrlPassword = decodeURIComponent(parsed.password);
      }
    } catch {
      errors.push('REDIS_URL is invalid');
    }
  }

  const explicitRedisPassword = process.env.REDIS_PASSWORD?.trim();
  const redisPasswordMismatch =
    redisUrlPassword && explicitRedisPassword && redisUrlPassword !== explicitRedisPassword;
  if (redisPasswordMismatch) {
    errors.push('REDIS_URL password does not match REDIS_PASSWORD');
  }

  const redisPasswords: string[] = [];
  if (redisUrlPassword && explicitRedisPassword) {
    // When both exist, validate URL password quality (and env password if they mismatch)
    redisPasswords.push(redisUrlPassword);
    if (redisPasswordMismatch) {
      redisPasswords.push(explicitRedisPassword);
    }
  } else if (redisUrlPassword) {
    redisPasswords.push(redisUrlPassword);
  } else if (explicitRedisPassword) {
    redisPasswords.push(explicitRedisPassword);
  }

  if (redisPasswords.length === 0) {
    errors.push('Redis password must be set via REDIS_URL or REDIS_PASSWORD');
  } else {
    // Validate password quality (even if mismatch, for better UX)
    for (const password of redisPasswords) {
      if (REDIS_PASSWORD_DEFAULTS.includes(password)) {
        errors.push('Redis password is set to an insecure default value');
      }
      if (password.length < MIN_REDIS_PASSWORD_LENGTH) {
        errors.push(`Redis password must be at least ${MIN_REDIS_PASSWORD_LENGTH} characters long`);
      }
    }
  }

  // Check DATABASE_URL SSL in production
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set');
  } else if (!process.env.DATABASE_URL.includes('sslmode=require')) {
    errors.push('DATABASE_URL must include sslmode=require in production');
  }

  // Validate trust proxy configuration
  const trustProxyMode = getTrustProxyMode();
  if (!isTrustProxyConfigSafe()) {
    if (trustProxyMode === 'true') {
      errors.push('TRUST_PROXY_MODE is unsafe in production. Use "ips" or "loopback" instead.');
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

  if (errors.length > 0) {
    console.error('\n❌ FATAL: Production environment validation failed:\n');
    errors.forEach((error) => console.error(`   - ${error}`));
    console.error('\n🛑 Application will not start. Fix the above issues and restart.\n');
    process.exit(1);
  }

  console.log('✅ Production environment variables validated successfully');
}
