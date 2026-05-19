import { hashEmailHmac } from '../../lib/hash-email';

export function hashEmail(email: string): string {
  return hashEmailHmac(email);
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== 'string' || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function shouldStorePlaintextEmail(): boolean {
  // Production must never persist plaintext email in LoginAttempt.
  // Dev/test can still opt-in explicitly for local debugging.
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return parseBoolean(process.env.LOGINATTEMPT_STORE_PLAINTEXT_EMAIL, false);
}

export function buildLoginAttemptData(input: {
  email: string;
  ipHash?: string;
  userAgent?: string;
  success: boolean;
  reason?: string;
  userId?: string;
}) {
  return {
    email: shouldStorePlaintextEmail() ? input.email : null,
    emailHash: hashEmail(input.email),
    ipHash: input.ipHash,
    userAgent: input.userAgent,
    success: input.success,
    reason: input.reason,
    userId: input.userId,
  };
}
