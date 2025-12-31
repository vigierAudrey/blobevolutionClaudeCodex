/**
 * Client IP extraction with safe-by-default proxy trust.
 *
 * This module provides secure IP extraction that prevents spoofing attacks
 * via X-Forwarded-For headers. Trust proxy mode must be explicitly configured.
 *
 * Security Design:
 * - Default: DO NOT trust proxy headers (prevents spoofing)
 * - Trust proxy ONLY when explicitly configured via TRUST_PROXY_MODE
 * - Fail-fast in production if proxy mode is misconfigured
 *
 * @see https://expressjs.com/en/guide/behind-proxies.html
 */

import { Request } from 'express';

export type TrustProxyMode = 'disabled' | 'loopback' | 'ips' | 'true';

/**
 * Get trust proxy mode from environment variable.
 *
 * Modes:
 * - 'disabled' (default): Do NOT trust proxy headers
 * - 'loopback': Trust only loopback (127.0.0.1, ::1)
 * - 'ips': Trust specific IPs (requires TRUSTED_PROXY_IPS)
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
 * Extract client IP address with safe-by-default proxy trust.
 *
 * This function prevents IP spoofing by NOT trusting X-Forwarded-For
 * headers unless explicitly configured via TRUST_PROXY_MODE.
 *
 * Behavior by trust proxy mode:
 * - disabled: Use req.socket.remoteAddress ONLY (no proxy headers)
 * - loopback: Use req.ip if proxy is loopback, else socket address
 * - ips: Use req.ips[0] if Express trust proxy is configured correctly
 * - true: Use req.ips[0] or req.ip (trust all - DANGEROUS)
 *
 * @param req - Express request object
 * @returns Client IP address or undefined if unavailable
 */
export function getClientIp(req: Request): string | undefined {
  const mode = getTrustProxyMode();

  switch (mode) {
    case 'disabled':
      // Safe default: only use socket address (no proxy headers)
      return req.socket?.remoteAddress || undefined;

    case 'loopback':
      // Trust proxy ONLY if it's loopback (dev local)
      const socketIp = req.socket?.remoteAddress;
      const isLoopback =
        socketIp === '127.0.0.1' ||
        socketIp === '::1' ||
        socketIp === '::ffff:127.0.0.1';

      if (isLoopback) {
        // Proxy is loopback, trust X-Forwarded-For (via Express req.ip)
        return req.ip || socketIp || undefined;
      } else {
        // Proxy is NOT loopback, do NOT trust headers
        return socketIp || undefined;
      }

    case 'ips':
      // Trust proxy if Express trust proxy is configured with TRUSTED_PROXY_IPS
      // Express populates req.ips array when trust proxy is set correctly
      const ips = (req as any).ips as string[] | undefined;
      if (ips && ips.length > 0) {
        // First IP in chain is the original client
        return ips[0];
      }
      // Fallback to req.ip (Express sets this based on trust proxy config)
      return req.ip || req.socket?.remoteAddress || undefined;

    case 'true':
      // DANGEROUS: Trust all proxies (not recommended in production)
      const allIps = (req as any).ips as string[] | undefined;
      if (allIps && allIps.length > 0) {
        return allIps[0];
      }
      return req.ip || req.socket?.remoteAddress || undefined;

    default:
      // Should never happen due to getTrustProxyMode validation
      return req.socket?.remoteAddress || undefined;
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

    // 'ips' mode requires TRUSTED_PROXY_IPS to be set
    if (mode === 'ips') {
      const trustedProxies = process.env.TRUSTED_PROXY_IPS?.trim();
      return Boolean(trustedProxies && trustedProxies.length > 0);
    }
  }

  return true;
}
