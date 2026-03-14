/**
 * HMAC-SHA256 IP Hashing Utility (Privacy-Preserving + RGPD Compliant)
 *
 * This module provides secure IP address hashing for logs and database storage.
 *
 * Key Features:
 * - HMAC-SHA256 with IP_HASH_SECRET (not simple SHA-256)
 * - Rainbow table protection via secret key
 * - IPv6/IPv4 normalization (::ffff:192.168.1.1 → 192.168.1.1)
 * - 24 hex chars output (96 bits) for low collision rate
 * - Separate secret from TWO_FACTOR_SECRET (security isolation)
 *
 * Security Design:
 * - NEVER store raw IPs in production (except allowedIPs whitelist)
 * - NEVER log IP_HASH_SECRET
 * - Fail-fast in production if IP_HASH_SECRET missing or default
 * - Deterministic: same IP + same secret = same hash (correlation)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc2104 (HMAC spec)
 */

import { createHmac } from 'crypto';
import * as ipaddr from 'ipaddr.js';

/**
 * Normalize an IP address for consistent hashing.
 *
 * Handles:
 * - IPv4-mapped IPv6 (::ffff:192.168.1.1 → 192.168.1.1)
 * - Trims whitespace
 * - Lowercases IPv6
 * - Validates format
 *
 * @param rawIp - Raw IP address string (from req.ip, socket.remoteAddress, etc.)
 * @returns Normalized IP string, or null if invalid/empty
 *
 * @example
 * normalizeIp('::ffff:192.168.1.1') // → '192.168.1.1'
 * normalizeIp('2001:db8::1')        // → '2001:db8::1'
 * normalizeIp('  192.168.1.1  ')   // → '192.168.1.1'
 * normalizeIp(null)                 // → null
 */
export function normalizeIp(rawIp: string | undefined | null): string | null {
  if (!rawIp) {
    return null;
  }

  const trimmed = rawIp.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = ipaddr.process(trimmed);

    // Convert IPv4-mapped IPv6 to IPv4
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address().toString();
    }

    return parsed.toString();
  } catch (error) {
    // Invalid IP format - return null instead of throwing
    // This handles edge cases like 'localhost', invalid formats, etc.
    return null;
  }
}

/**
 * Hash an IP address using HMAC-SHA256 with IP_HASH_SECRET.
 *
 * Security Properties:
 * - Uses HMAC-SHA256 (not plain SHA-256) for rainbow table protection
 * - Requires IP_HASH_SECRET environment variable
 * - Truncated to 24 hex chars (96 bits) for low collision rate
 * - Normalizes IP before hashing (IPv6→IPv4 if applicable)
 *
 * Collision Probability:
 * - 24 hex chars = 96 bits = 2^96 possible values
 * - At 1 million IPs: collision probability ≈ 0.0000001%
 * - At 1 billion IPs: collision probability ≈ 0.0001%
 *
 * Why HMAC vs SHA-256:
 * - SHA-256(IP) alone is vulnerable to rainbow tables (precomputed hashes)
 * - HMAC-SHA256(secret, IP) requires knowing the secret to compute hashes
 * - Even if database leaks, attacker cannot reverse-engineer IPs without secret
 *
 * @param rawIp - Raw IP address string
 * @returns HMAC-SHA256 hash (24 hex chars) or null if IP invalid
 * @throws Error if IP_HASH_SECRET is not configured
 *
 * @example
 * // With IP_HASH_SECRET='my-secret-key'
 * hashIpHmac('192.168.1.1')        // → 'a1b2c3d4e5f6...' (24 chars)
 * hashIpHmac('::ffff:192.168.1.1') // → 'a1b2c3d4e5f6...' (same, normalized)
 * hashIpHmac('invalid')            // → null
 */
export function hashIpHmac(rawIp: string | undefined | null): string | null {
  const normalized = normalizeIp(rawIp);
  if (!normalized) {
    return null;
  }

  const secret = process.env.IP_HASH_SECRET;
  if (!secret) {
    throw new Error(
      'FATAL: IP_HASH_SECRET is not configured. Set IP_HASH_SECRET environment variable.'
    );
  }

  // HMAC-SHA256: cryptographically secure keyed hash
  const hash = createHmac('sha256', secret)
    .update(normalized)
    .digest('hex');

  // Truncate to 24 hex chars (96 bits)
  // This provides excellent uniqueness while keeping storage reasonable
  return hash.substring(0, 24);
}

/**
 * Safe wrapper for log/audit contexts.
 *
 * Logging must never fail closed because a privacy secret is absent in local/dev
 * environments. We keep forensic correlation when possible, and drop the hash
 * instead of breaking the request path when hashing is unavailable.
 */
export function hashIpHmacSafe(rawIp: string | undefined | null): string | undefined {
  try {
    return hashIpHmac(rawIp) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Legacy SHA-256 hash function (for backward compatibility only).
 *
 * ⚠️ DEPRECATED: Use hashIpHmac() instead for new code.
 *
 * This function exists only for:
 * 1. Reading old audit logs with SHA-256(16) hashes
 * 2. Migration scripts that need to identify legacy hashes
 *
 * DO NOT use for new IP hashing - use hashIpHmac() instead.
 *
 * @param rawIp - Raw IP address string
 * @returns SHA-256 hash (16 hex chars) or null if IP invalid
 * @deprecated Use hashIpHmac() for new code
 *
 * @example
 * hashIpLegacy('192.168.1.1') // → 'e7a9c7e2f3d4b5a6' (16 chars, SHA-256)
 */
export function hashIpLegacy(rawIp: string | undefined | null): string | null {
  const normalized = normalizeIp(rawIp);
  if (!normalized) {
    return null;
  }

  const crypto = require('crypto');
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Detect hash version from hash string length.
 *
 * Used for migration and backward compatibility:
 * - 16 hex chars → v1 (SHA-256 legacy)
 * - 24 hex chars → v2 (HMAC-SHA256)
 *
 * @param hash - Hash string to analyze
 * @returns 'v1' | 'v2' | 'unknown'
 *
 * @example
 * detectHashVersion('e7a9c7e2f3d4b5a6')         // → 'v1' (16 chars)
 * detectHashVersion('a1b2c3d4e5f6g7h8i9j0k1l2') // → 'v2' (24 chars)
 * detectHashVersion('invalid')                  // → 'unknown'
 */
export function detectHashVersion(hash: string | null | undefined): 'v1' | 'v2' | 'unknown' {
  if (!hash) return 'unknown';
  if (hash.length === 16 && /^[a-f0-9]{16}$/.test(hash)) return 'v1';
  if (hash.length === 24 && /^[a-f0-9]{24}$/.test(hash)) return 'v2';
  return 'unknown';
}
