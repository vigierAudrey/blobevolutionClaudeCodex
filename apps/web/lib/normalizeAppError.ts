import type { AppError, ErrorSource, ErrorKind, ActionHint } from './types/appError';
import { ERROR_CODES } from './socketAck';

/**
 * Client-only error codes (NOT in ERROR_CODES)
 */
const CLIENT_ONLY_CODES = new Set([
  'CLIENT_TIMEOUT',
  'NOT_CONNECTED',
  'NO_SOCKET',
  'AUTH_FAILED',
  'CONNECT_ERROR',
  'INVALID_ENVELOPE',
  'INVALID_RESPONSE',
  'INVALID_JSON',
]);

/**
 * Classify error code into kind, canRetry, and actionHint
 */
function classifyError(code: string, retryAfterSeconds?: number): {
  kind: ErrorKind;
  canRetry: boolean;
  actionHint: ActionHint;
} {
  // RATE_LIMITED: transient, canRetry false if retryAfterSeconds > 0, actionHint retry
  if (code === ERROR_CODES.RATE_LIMITED) {
    return {
      kind: 'transient',
      canRetry: false, // User must wait for cooldown
      actionHint: 'retry',
    };
  }

  // INTERNAL_ERROR, INVALID_RESPONSE: transient, canRetry true, actionHint retry
  if (code === ERROR_CODES.INTERNAL_ERROR || code === 'INVALID_RESPONSE') {
    return {
      kind: 'transient',
      canRetry: true,
      actionHint: 'retry',
    };
  }

  // UNAUTHORIZED, AUTH_FAILED: permanent/client_only, canRetry false, actionHint relogin
  if (code === ERROR_CODES.UNAUTHORIZED || code === 'AUTH_FAILED') {
    return {
      kind: code === 'AUTH_FAILED' ? 'client_only' : 'permanent',
      canRetry: false,
      actionHint: 'relogin',
    };
  }

  // FORBIDDEN: permanent, canRetry false, actionHint contact_support
  if (code === ERROR_CODES.FORBIDDEN) {
    return {
      kind: 'permanent',
      canRetry: false,
      actionHint: 'contact_support',
    };
  }

  // VALIDATION_ERROR, UNIQUE_CONSTRAINT, BOOKING_CONFLICT, MATCHING_CONFLICT: permanent, canRetry false, actionHint fix_input
  if (
    code === ERROR_CODES.VALIDATION_ERROR ||
    code === ERROR_CODES.UNIQUE_CONSTRAINT ||
    code === ERROR_CODES.BOOKING_CONFLICT ||
    code === ERROR_CODES.MATCHING_CONFLICT
  ) {
    return {
      kind: 'permanent',
      canRetry: false,
      actionHint: 'fix_input',
    };
  }

  // CLIENT_TIMEOUT, NOT_CONNECTED, NO_SOCKET, CONNECT_ERROR: client_only, actionHint retry
  if (CLIENT_ONLY_CODES.has(code)) {
    return {
      kind: 'client_only',
      canRetry: true,
      actionHint: 'retry',
    };
  }

  // Fallback: treat as transient with retry
  return {
    kind: 'transient',
    canRetry: true,
    actionHint: 'retry',
  };
}

/**
 * Extract retryAfter from error object
 * Supports both top-level retryAfter and details.retryAfter
 */
function extractRetryAfter(err: any): number | undefined {
  // Top-level retryAfter
  if (typeof err?.retryAfter === 'number' && err.retryAfter > 0) {
    return err.retryAfter;
  }

  // details.retryAfter
  if (typeof err?.details === 'object' && err.details !== null) {
    const detailsRetryAfter = (err.details as Record<string, unknown>).retryAfter;
    if (typeof detailsRetryAfter === 'number' && detailsRetryAfter > 0) {
      return detailsRetryAfter;
    }
  }

  return undefined;
}

/**
 * Detect error source based on error shape
 */
function detectSource(err: any): ErrorSource {
  // HTTP strict error: has status or url from requestStrict (check first to handle client-only codes with HTTP context)
  if (err?.status !== undefined || err?.url !== undefined) {
    return 'HTTP_STRICT';
  }

  // WS ACK error: has client-only code (CLIENT_TIMEOUT, NOT_CONNECTED, etc.)
  if (err?.code && typeof err.code === 'string' && CLIENT_ONLY_CODES.has(err.code)) {
    return 'WS_ACK';
  }

  // WS channel error: has code from ERROR_CODES + message, from socket-error/error event
  if (err?.code && typeof err.code === 'string' && err.code in ERROR_CODES) {
    return 'WS_CHANNEL';
  }

  // Legacy Error
  if (err instanceof Error) {
    return 'HTTP_LEGACY';
  }

  return 'UNKNOWN';
}

/**
 * Normalize any error into a unified AppError
 *
 * Sources handled:
 * - WS ACK errors (from emitWithAck timeout or server ACK)
 * - WS channel errors (from socket-error/error event)
 * - HTTP Strict errors (from requestStrict)
 * - HTTP parsing/network errors (INVALID_ENVELOPE, INVALID_JSON, INVALID_RESPONSE)
 * - Legacy Error (from old apiClient.request)
 * - Unknown (fallback)
 *
 * NEVER throws - always returns a valid AppError.
 *
 * @param err - Error from any source
 * @returns Normalized AppError
 */
export function normalizeAppError(err: unknown): AppError {
  try {
    const errAny = err as any;

    // Extract basic fields
    const source = detectSource(errAny);
    const code = typeof errAny?.code === 'string' ? errAny.code : 'INTERNAL_ERROR';
    const message = errAny?.message || (err != null ? String(err) : 'Unknown error');
    const retryAfterSeconds = extractRetryAfter(errAny);

    // Classify error
    const { kind, canRetry, actionHint } = classifyError(code, retryAfterSeconds);

    // Build debug info
    const debug: AppError['debug'] = {};
    if (errAny?.status !== undefined) debug.status = errAny.status;
    if (errAny?.url) debug.url = errAny.url;
    if (errAny?.details !== undefined) debug.details = errAny.details;

    return {
      source,
      kind,
      code,
      message,
      retryAfterSeconds,
      canRetry,
      actionHint,
      debug: Object.keys(debug).length > 0 ? debug : undefined,
    };
  } catch (normalizationError) {
    // Fallback: if normalization itself fails, return minimal AppError
    return {
      source: 'UNKNOWN',
      kind: 'transient',
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      canRetry: true,
      actionHint: 'retry',
    };
  }
}
