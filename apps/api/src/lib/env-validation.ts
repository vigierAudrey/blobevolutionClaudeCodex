/**
 * Environment variable validation for production safety.
 *
 * This module ensures critical environment variables are properly set
 * before the application starts. Prevents deployment with insecure defaults.
 */

const INSECURE_DEFAULTS = {
  REDIS_PASSWORD: ['change-me-strong', 'change-me'],
  TWO_FACTOR_SECRET: ['change-me-2fa-secret-production', 'change-me'],
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
  } else if (!process.env.DATABASE_URL.includes('sslmode=require')) {
    console.warn('⚠️  WARNING: DATABASE_URL does not include sslmode=require (recommended in production)');
  }

  // Check TRUSTED_PROXY_IPS if behind proxy
  if (!process.env.TRUSTED_PROXY_IPS) {
    console.warn('⚠️  WARNING: TRUSTED_PROXY_IPS not set. IP extraction may be unreliable behind reverse proxy.');
  }

  if (errors.length > 0) {
    console.error('\n❌ FATAL: Production environment validation failed:\n');
    errors.forEach((error) => console.error(`   - ${error}`));
    console.error('\n🛑 Application will not start. Fix the above issues and restart.\n');
    process.exit(1);
  }

  console.log('✅ Production environment variables validated successfully');
}
