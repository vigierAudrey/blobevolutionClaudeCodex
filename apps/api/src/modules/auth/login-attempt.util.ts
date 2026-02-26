import { createHash } from 'crypto';

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
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
  // Secure default: never store plaintext email in LoginAttempt.
  // Dev/test can opt-in explicitly with LOGINATTEMPT_STORE_PLAINTEXT_EMAIL=true.
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
