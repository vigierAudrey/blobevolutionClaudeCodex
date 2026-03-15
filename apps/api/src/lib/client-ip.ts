/**
 * Client IP extraction with safe-by-default proxy trust.
 *
 * This module provides secure IP extraction that prevents spoofing attacks
 * via X-Forwarded-For headers. Trust proxy mode must be explicitly configured.
 *
 * Security Design:
 * - Default: DO NOT trust proxy headers (prevents spoofing)
 * - Trust proxy ONLY when explicitly configured via TRUST_PROXY_MODE
 * - NEVER trust X-Forwarded-For without validating socket IP against TRUSTED_PROXY_IPS
 * - Support CIDR notation (e.g., 10.0.0.0/8, 172.16.0.0/12)
 * - Fail-fast in production if proxy mode is misconfigured
 *
 * @see https://expressjs.com/en/guide/behind-proxies.html
 */

import { Request } from 'express';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';
import * as ipaddr from 'ipaddr.js';
import { secureLogger } from '../utils/secure-logger';

export type TrustProxyMode = 'disabled' | 'loopback' | 'ips' | 'true';

/**
 * Parsed trusted proxy configuration (IP addresses and CIDR ranges).
 */
interface TrustedProxyConfig {
  singleIps: string[];
  cidrRanges: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]>;
}

/**
 * Cached parsed trusted proxy list (to avoid re-parsing on every request).
 */
let cachedTrustedProxies: TrustedProxyConfig | null = null;

/**
 * Get trust proxy mode from environment variable.
 *
 * Modes:
 * - 'disabled' (default): Do NOT trust proxy headers
 * - 'loopback': Trust only loopback (127.0.0.1, ::1)
 * - 'ips': Trust specific IPs/CIDRs (requires TRUSTED_PROXY_IPS)
 * - 'true': Trust all proxies (DANGEROUS - avoid in production)
 */
export function getTrustProxyMode(): TrustProxyMode {
  const mode = process.env.TRUST_PROXY_MODE?.toLowerCase().trim();

  if (!mode || mode === 'disabled' || mode === 'false') {
    return 'disabled';
  }

  if (mode === 'loopback') {
    return 'loopback';
  }

  if (mode === 'ips') {
    return 'ips';
  }

  if (mode === 'true') {
    return 'true';
  }

  secureLogger.warn('TRUST_PROXY_MODE_UNKNOWN', { mode });
  return 'disabled';
}

/**
 * Parse TRUSTED_PROXY_IPS environment variable into validated IP/CIDR list.
 *
 * Format: comma-separated list of IPs and/or CIDR ranges
 * Example: "10.0.0.1,192.168.1.0/24,2001:db8::/32"
 *
 * @returns Parsed configuration or null if invalid/empty
 */
export function parseTrustedProxies(): TrustedProxyConfig | null {
  // Return cached result if already parsed
  if (cachedTrustedProxies !== null) {
    return cachedTrustedProxies;
  }

  const raw = process.env.TRUSTED_PROXY_IPS?.trim();
  if (!raw) {
    cachedTrustedProxies = null;
    return null;
  }

  const singleIps: string[] = [];
  const cidrRanges: Array<[ipaddr.IPv4 | ipaddr.IPv6, number]> = [];

  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);

  for (const entry of entries) {
    try {
      if (entry.includes('/')) {
        // CIDR notation
        const [addr, prefixStr] = entry.split('/');
        const prefix = parseInt(prefixStr, 10);

        if (isNaN(prefix)) {
          secureLogger.error('TRUSTED_PROXY_CIDR_INVALID', { entry });
          continue;
        }

        const parsed = ipaddr.process(addr);
        cidrRanges.push([parsed, prefix]);
      } else {
        // Single IP
        const parsed = ipaddr.process(entry);
        singleIps.push(parsed.toString()); // Normalize format
      }
    } catch (error) {
      secureLogger.error('TRUSTED_PROXY_ENTRY_INVALID', { entry, error });
    }
  }

  if (singleIps.length === 0 && cidrRanges.length === 0) {
    secureLogger.error('TRUSTED_PROXY_LIST_EMPTY');
    cachedTrustedProxies = null;
    return null;
  }

  cachedTrustedProxies = { singleIps, cidrRanges };
  return cachedTrustedProxies;
}

/**
 * Check if an IP address is in the trusted proxy list (supports CIDR).
 *
 * @param ip - IP address to check (will be normalized)
 * @param config - Parsed trusted proxy configuration
 * @returns true if IP is trusted, false otherwise
 */
export function isIpTrusted(ip: string | undefined, config: TrustedProxyConfig | null): boolean {
  if (!ip || !config) {
    return false;
  }

  try {
    const parsed = ipaddr.process(ip);
    const normalized = parsed.toString();

    // Check single IPs (exact match)
    if (config.singleIps.includes(normalized)) {
      return true;
    }

    // Check CIDR ranges
    for (const [rangeAddr, prefix] of config.cidrRanges) {
      if (parsed.kind() === rangeAddr.kind() && parsed.match(rangeAddr, prefix)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    // Invalid IP format
    return false;
  }
}

/**
 * Normalize IPv4-mapped IPv6 addresses to IPv4.
 *
 * Example: ::ffff:192.168.1.1 → 192.168.1.1
 *
 * @param ip - IP address string
 * @returns Normalized IP or original if not IPv4-mapped
 */
export function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) {
    return undefined;
  }

  try {
    const parsed = ipaddr.process(ip);

    // Convert IPv4-mapped IPv6 to IPv4
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address().toString();
    }

    return parsed.toString();
  } catch (error) {
    // If parsing fails, return original (could be localhost, etc.)
    return ip;
  }
}

/**
 * Get socket IP address from request (handles both req.socket and req.connection).
 *
 * @param req - Express request object
 * @returns Socket IP address or undefined
 */
function getSocketIpFromLike(req: {
  socket?: { remoteAddress?: string | undefined } | undefined;
  connection?: { remoteAddress?: string | undefined } | undefined;
}): string | undefined {
  // Try req.socket.remoteAddress first (modern Express)
  const socketIp = req.socket?.remoteAddress;
  if (socketIp) {
    return normalizeIp(socketIp);
  }

  // Fallback to req.connection.remoteAddress (older Express)
  const connectionIp = (req as any).connection?.remoteAddress;
  if (connectionIp) {
    return normalizeIp(connectionIp);
  }

  return undefined;
}

function getSocketIp(req: Request): string | undefined {
  return getSocketIpFromLike(req as unknown as {
    socket?: { remoteAddress?: string | undefined };
    connection?: { remoteAddress?: string | undefined };
  });
}

function getFirstForwardedFor(headers: IncomingHttpHeaders | undefined): string | undefined {
  if (!headers) return undefined;
  const raw = headers['x-forwarded-for'];
  if (!raw) return undefined;

  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return undefined;

  const firstIp = first.split(',').map((part) => part.trim()).filter(Boolean)[0];
  return normalizeIp(firstIp);
}

/**
 * Check if an IP is a loopback address.
 *
 * @param ip - IP address string
 * @returns true if loopback, false otherwise
 */
function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) {
    return false;
  }

  // Normalize first
  const normalized = normalizeIp(ip);
  if (!normalized) {
    return false;
  }

  // Check common loopback patterns
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('127.') ||
    normalized === '::ffff:127.0.0.1'
  );
}

/**
 * Extract client IP address with safe-by-default proxy trust.
 *
 * This function prevents IP spoofing by NOT trusting X-Forwarded-For
 * headers unless explicitly configured via TRUST_PROXY_MODE.
 *
 * CRITICAL SECURITY RULE:
 * - NEVER trust req.ips or X-Forwarded-For headers without first validating
 *   that req.socket.remoteAddress is in TRUSTED_PROXY_IPS (with CIDR support)
 *
 * Behavior by trust proxy mode:
 * - disabled: Use socket IP ONLY (ignore all proxy headers)
 * - loopback: Trust headers ONLY if socket IP is loopback
 * - ips: Trust headers ONLY if socket IP matches TRUSTED_PROXY_IPS (CIDR supported)
 * - true: Trust all headers (DANGEROUS - blocked in production)
 *
 * @param req - Express request object
 * @returns Client IP address or undefined if unavailable
 */
export function getClientIp(req: Request): string | undefined {
  const mode = getTrustProxyMode();
  const socketIp = getSocketIp(req);

  switch (mode) {
    case 'disabled':
      // Safe default: only use socket address (ignore ALL proxy headers)
      return socketIp;

    case 'loopback':
      // Trust proxy ONLY if socket IP is loopback (dev local)
      if (isLoopbackIp(socketIp)) {
        // Socket is loopback, trust X-Forwarded-For
        const ips = (req as any).ips as string[] | undefined;
        if (ips && ips.length > 0) {
          return normalizeIp(ips[0]);
        }
        // Fallback to req.ip if ips array not populated
        return normalizeIp(req.ip) || socketIp;
      } else {
        // Socket is NOT loopback, do NOT trust headers
        return socketIp;
      }

    case 'ips':
      // CRITICAL: Trust proxy ONLY if socket IP is in TRUSTED_PROXY_IPS
      const trustedConfig = parseTrustedProxies();

      if (!trustedConfig) {
        // No valid trusted proxies configured - fall back to socket IP
        secureLogger.warn('TRUSTED_PROXY_IPS_INVALID_SOCKET_FALLBACK');
        return socketIp;
      }

      // Validate socket IP against trusted list (supports CIDR)
      if (isIpTrusted(socketIp, trustedConfig)) {
        // Socket IP is trusted proxy, extract client IP from headers
        const ips = (req as any).ips as string[] | undefined;
        if (ips && ips.length > 0) {
          // First IP in X-Forwarded-For chain is the original client
          return normalizeIp(ips[0]);
        }
        // Fallback to req.ip
        return normalizeIp(req.ip) || socketIp;
      } else {
        // Socket IP is NOT in trusted list - IGNORE all proxy headers
        // This prevents spoofing attacks
        return socketIp;
      }

    case 'true':
      // DANGEROUS: Trust all proxies (should be blocked in production)
      const allIps = (req as any).ips as string[] | undefined;
      if (allIps && allIps.length > 0) {
        return normalizeIp(allIps[0]);
      }
      return normalizeIp(req.ip) || socketIp;

    default:
      // Should never happen due to getTrustProxyMode validation
      return socketIp;
  }
}

type SocketReqLike = Pick<IncomingMessage, 'socket' | 'headers'> & {
  connection?: { remoteAddress?: string | undefined } | undefined;
};

/**
 * Extract client IP from a raw Node request (Engine.IO / Socket.IO handshake).
 * Applies the same TRUST_PROXY_MODE security policy as getClientIp().
 */
export function getClientIpFromIncomingRequest(req: SocketReqLike): string | undefined {
  const mode = getTrustProxyMode();
  const socketIp = getSocketIpFromLike(req);
  const forwardedFor = getFirstForwardedFor(req.headers);

  switch (mode) {
    case 'disabled':
      return socketIp;

    case 'loopback':
      return isLoopbackIp(socketIp) ? (forwardedFor || socketIp) : socketIp;

    case 'ips': {
      const trustedConfig = parseTrustedProxies();
      if (!trustedConfig) {
        secureLogger.warn('TRUSTED_PROXY_IPS_INVALID_SOCKET_FALLBACK');
        return socketIp;
      }
      return isIpTrusted(socketIp, trustedConfig) ? (forwardedFor || socketIp) : socketIp;
    }

    case 'true':
      return forwardedFor || socketIp;

    default:
      return socketIp;
  }
}

/**
 * Check if current trust proxy configuration is safe for production.
 *
 * Returns true if configuration is safe, false otherwise.
 * In production, modes 'disabled', 'loopback', or 'ips' are considered safe.
 * Mode 'true' is NOT safe in production.
 */
export function isTrustProxyConfigSafe(): boolean {
  const mode = getTrustProxyMode();

  if (process.env.NODE_ENV === 'production') {
    // In production, 'true' is NEVER safe
    if (mode === 'true') {
      return false;
    }

    // 'ips' mode requires valid TRUSTED_PROXY_IPS
    if (mode === 'ips') {
      const config = parseTrustedProxies();
      return config !== null;
    }
  }

  return true;
}

/**
 * Hash an IP address for privacy-preserving logs/storage (RGPD compliant).
 *
 * ⚠️ DEPRECATED: Use hashIpHmac() from '../lib/hash-ip' instead.
 *
 * This function uses plain SHA-256 (vulnerable to rainbow tables).
 * hashIpHmac() uses HMAC-SHA256 with IP_HASH_SECRET for better security.
 *
 * This function is kept only for backward compatibility with existing tests.
 * DO NOT use in new application code.
 *
 * @param ip - IP address to hash
 * @returns Hashed IP (SHA-256 truncated to 16 chars)
 * @deprecated Use hashIpHmac() from '../lib/hash-ip' instead
 */
export function hashIp(ip: string | undefined): string | undefined {
  if (!ip) {
    return undefined;
  }

  const crypto = require('crypto');
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

/**
 * Reset cached trusted proxies (useful for testing).
 * @internal
 */
export function resetTrustedProxiesCache(): void {
  cachedTrustedProxies = null;
}
