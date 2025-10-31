const ensureSecretLength = (key: 'SESSION_SECRET' | 'JWT_SECRET' | 'JWT_REFRESH_SECRET') => {
  const current = process.env[key];
  if (!current || current.length < 64) {
    const filler = key === 'SESSION_SECRET' ? 's' : key === 'JWT_SECRET' ? 'j' : 'r';
    process.env[key] = filler.repeat(64);
  }
};

ensureSecretLength('SESSION_SECRET');
ensureSecretLength('JWT_SECRET');
ensureSecretLength('JWT_REFRESH_SECRET');
