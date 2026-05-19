// ⚠️ IMPORTANT : Ces secrets doivent être définis AVANT tout import de modules
// car auth.service.ts valide les secrets à l'import via ensureStrongSecret()

const ensureSecretLength = (key: 'SESSION_SECRET' | 'JWT_SECRET' | 'JWT_REFRESH_SECRET') => {
  const current = process.env[key];
  if (!current || current.length < 64) {
    const filler = key === 'SESSION_SECRET' ? 's' : key === 'JWT_SECRET' ? 'j' : 'r';
    process.env[key] = filler.repeat(64);
  }
};

// Définir tous les secrets requis pour les tests
ensureSecretLength('SESSION_SECRET');
ensureSecretLength('JWT_SECRET');
ensureSecretLength('JWT_REFRESH_SECRET');

if (!process.env.IP_HASH_SECRET || process.env.IP_HASH_SECRET.length < 32) {
  process.env.IP_HASH_SECRET = 'i'.repeat(64);
}

if (!process.env.EMAIL_HASH_SECRET || process.env.EMAIL_HASH_SECRET.length < 32) {
  process.env.EMAIL_HASH_SECRET = 'e'.repeat(64);
}

if (!process.env.LOG_ACTOR_SECRET || process.env.LOG_ACTOR_SECRET.length < 32) {
  process.env.LOG_ACTOR_SECRET = 'l'.repeat(64);
}

if (!process.env.CSRF_SECRET) {
  process.env.CSRF_SECRET = 'csrf-test-secret'.padEnd(32, 'x');
}

// Vérification finale : s'assurer que tous les secrets critiques sont présents
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 64) {
  throw new Error('JWT_SECRET must be set and >= 64 characters in test environment');
}

if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 64) {
  throw new Error('JWT_REFRESH_SECRET must be set and >= 64 characters in test environment');
}
