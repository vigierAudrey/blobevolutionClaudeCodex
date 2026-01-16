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
function classifyError(code: string, _retryAfterSeconds?: number): {
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
function extractRetryAfter(err: unknown): number | undefined {
  // Type guard for object with retryAfter
  if (typeof err === 'object' && err !== null && 'retryAfter' in err) {
    const retryAfter = (err as { retryAfter: unknown }).retryAfter;
    if (typeof retryAfter === 'number' && retryAfter > 0) {
      return retryAfter;
    }
  }

  // details.retryAfter
  if (typeof err === 'object' && err !== null && 'details' in err) {
    const details = (err as { details: unknown }).details;
    if (typeof details === 'object' && details !== null && 'retryAfter' in details) {
      const detailsRetryAfter = (details as { retryAfter: unknown }).retryAfter;
      if (typeof detailsRetryAfter === 'number' && detailsRetryAfter > 0) {
        return detailsRetryAfter;
      }
    }
  }

  return undefined;
}

/**
 * Detect error source based on error shape
 */
function detectSource(err: unknown): ErrorSource {
  // HTTP strict error: has status or url from requestStrict (check first to handle client-only codes with HTTP context)
  if (typeof err === 'object' && err !== null && ('status' in err || 'url' in err)) {
    return 'HTTP_STRICT';
  }

  // WS ACK error: has client-only code (CLIENT_TIMEOUT, NOT_CONNECTED, etc.)
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' && CLIENT_ONLY_CODES.has(code)) {
      return 'WS_ACK';
    }
    // WS channel error: has code from ERROR_CODES + message, from socket-error/error event
    if (typeof code === 'string' && code in ERROR_CODES) {
      return 'WS_CHANNEL';
    }
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
    // Extract basic fields with type guards
    const source = detectSource(err);

    // Extract code
    const code = (typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string')
      ? (err as { code: string }).code
      : 'INTERNAL_ERROR';

    // Extract message
    const message = (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message: unknown }).message === 'string')
      ? (err as { message: string }).message
      : (err != null ? String(err) : 'Unknown error');

    const retryAfterSeconds = extractRetryAfter(err);

    // Classify error
    const { kind, canRetry, actionHint } = classifyError(code, retryAfterSeconds);

    // Build debug info with type guards
    const debug: AppError['debug'] = {};
    if (typeof err === 'object' && err !== null) {
      if ('status' in err) {
        const status = (err as { status: unknown }).status;
        if (typeof status === 'number') debug.status = status;
      }
      if ('url' in err) {
        const url = (err as { url: unknown }).url;
        if (typeof url === 'string') debug.url = url;
      }
      if ('details' in err) {
        debug.details = (err as { details: unknown }).details;
      }
    }

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
