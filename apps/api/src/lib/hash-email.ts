/**
 * HMAC-SHA256 Email Hashing Utility (Privacy-Preserving + RGPD Compliant)
 *
 * Key Features:
 * - HMAC-SHA256 with EMAIL_HASH_SECRET (not plain SHA-256)
 * - Rainbow table protection via secret key
 * - Email normalization: trim + lowercase (RFC 5321)
 * - 32 hex chars output (128 bits) — distinguishable from legacy 64-char SHA-256 by length
 * - Separate secret from IP_HASH_SECRET (security isolation)
 *
 * Security Design:
 * - NEVER store raw emails in production
 * - NEVER log EMAIL_HASH_SECRET
 * - Fail-fast if EMAIL_HASH_SECRET missing (production and dev alike)
 * - Deterministic: same email + same secret = same hash (enables correlation)
 *
 * Migration note:
 * - v1 legacy hashes = 64 hex chars (SHA-256, no secret)
 * - v2 new hashes    = 32 hex chars (HMAC-SHA256, keyed)
 * - Old and new records coexist for up to 30 days (failure retention window).
 *   suspiciousOnly GROUP BY emailHash will see two distinct identities for the
 *   same email during that window — this is a known, time-bounded gap.
 * - Never rotate EMAIL_HASH_SECRET without purging LoginAttempt first.
 *
 * @see apps/api/src/lib/hash-ip.ts for the IP equivalent
 */

import { createHmac } from 'crypto';

function getEmailHashSecret(): string {
  const secret = process.env.EMAIL_HASH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'FATAL: EMAIL_HASH_SECRET is not configured. Set EMAIL_HASH_SECRET environment variable.'
    );
  }

  return secret;
}

/**
 * Hash an email address using HMAC-SHA256 with EMAIL_HASH_SECRET.
 *
 * @param email - Raw email address
 * @returns HMAC-SHA256 hash (32 hex chars, 128 bits)
 * @throws Error if EMAIL_HASH_SECRET is not configured
 */
export function hashEmailHmac(email: string): string {
  const secret = getEmailHashSecret();

  return createHmac('sha256', secret)
    .update(email.trim().toLowerCase())
    .digest('hex')
    .substring(0, 32); // 128 bits — distinguishable from legacy 64-char SHA-256
}

/**
 * Safe wrapper for log/audit contexts.
 * Logging must never throw because a secret is absent — returns undefined instead.
 */
export function hashEmailHmacSafe(email: string): string | undefined {
  try {
    return hashEmailHmac(email);
  } catch {
    return undefined;
  }
}

/**
 * Detect hash version from string length.
 * Used for migration diagnostics and backward compatibility.
 *
 * - v1: 64 hex chars (SHA-256 legacy, no secret)
 * - v2: 32 hex chars (HMAC-SHA256, keyed)
 */
export function detectEmailHashVersion(hash: string | null | undefined): 'v1' | 'v2' | 'unknown' {
  if (!hash) return 'unknown';
  if (hash.length === 64 && /^[a-f0-9]{64}$/.test(hash)) return 'v1';
  if (hash.length === 32 && /^[a-f0-9]{32}$/.test(hash)) return 'v2';
  return 'unknown';
}
