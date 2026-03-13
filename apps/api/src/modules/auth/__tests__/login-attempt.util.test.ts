import { afterEach, describe, expect, it } from '@jest/globals';
import { buildLoginAttemptData, hashEmail } from '../login-attempt.util';

describe('login-attempt.util', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalFlag = process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
    if (originalFlag === undefined) {
      delete process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL;
    } else {
      process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL = originalFlag;
    }
  });

  it('flag OFF (default): email doit etre null et emailHash present', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL;

    const result = buildLoginAttemptData({
      email: 'user@example.com',
      ipHash: 'iphash',
      userAgent: 'ua',
      success: false,
      reason: 'Invalid credentials',
    });

    expect(result.email).toBeNull();
    expect(result.emailHash).toBe(hashEmail('user@example.com'));
    expect(result.emailHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('flag ON: email clair autorise pour debug', () => {
    process.env.NODE_ENV = 'test';
    process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL = 'true';

    const result = buildLoginAttemptData({
      email: 'debug@example.com',
      success: true,
      userId: 'user-1',
    });

    expect(result.email).toBe('debug@example.com');
    expect(result.emailHash).toBe(hashEmail('debug@example.com'));
    expect(result.userId).toBe('user-1');
  });
});
