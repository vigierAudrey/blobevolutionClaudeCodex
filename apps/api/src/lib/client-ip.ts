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
import * as ipaddr from 'ipaddr.js';

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

  console.warn(`⚠️  Unknown TRUST_PROXY_MODE="${mode}", defaulting to "disabled"`);
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
          console.error(`❌ Invalid CIDR prefix in TRUSTED_PROXY_IPS: "${entry}"`);
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
      console.error(`❌ Invalid IP/CIDR in TRUSTED_PROXY_IPS: "${entry}"`, error);
    }
  }

  if (singleIps.length === 0 && cidrRanges.length === 0) {
    console.error('❌ TRUSTED_PROXY_IPS contains no valid entries');
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
function getSocketIp(req: Request): string | undefined {
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
        console.warn('⚠️  TRUST_PROXY_MODE=ips but TRUSTED_PROXY_IPS is empty/invalid. Using socket IP.');
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
 * Uses SHA-256 truncated to 16 characters.
 * This allows correlation of activity from the same IP without storing the raw IP.
 *
 * @param ip - IP address to hash
 * @returns Hashed IP (SHA-256 truncated to 16 chars)
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
