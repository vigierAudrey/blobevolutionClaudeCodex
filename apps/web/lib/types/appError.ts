/**
 * Unified application error types for front-end reliability layer
 *
 * DO NOT mix server ERROR_CODES with client-only codes.
 * - Server codes: VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN, INTERNAL_ERROR, etc.
 * - Client-only codes: CLIENT_TIMEOUT, NOT_CONNECTED, NO_SOCKET, etc.
 */

/**
 * Source of the error
 */
export type ErrorSource =
  | 'WS_ACK'          // From emitWithAck (timeout or server ACK error)
  | 'WS_CHANNEL'      // From socket-error/error event
  | 'HTTP_STRICT'     // From requestStrict (envelope validation)
  | 'HTTP_LEGACY'     // From legacy apiClient.request()
  | 'UNKNOWN';        // Fallback for unexpected error types

/**
 * Error classification
 * - transient: Temporary error, might succeed on retry (INTERNAL_ERROR, RATE_LIMITED after cooldown)
 * - permanent: Will not succeed on retry without user action (FORBIDDEN, VALIDATION_ERROR)
 * - client_only: Client-side error, not from server (CLIENT_TIMEOUT, NO_SOCKET)
 */
export type ErrorKind = 'transient' | 'permanent' | 'client_only';

/**
 * Suggested action for the user
 */
export type ActionHint =
  | 'retry'           // Show retry button (INTERNAL_ERROR, CLIENT_TIMEOUT)
  | 'relogin'         // Show re-login link (UNAUTHORIZED, AUTH_FAILED)
  | 'contact_support' // Show support contact (FORBIDDEN)
  | 'fix_input'       // Highlight invalid input (VALIDATION_ERROR)
  | 'none';           // No specific action

/**
 * Severity level for UI display
 */
export type Severity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Normalized application error
 *
 * This is the single error format used throughout the app after normalization.
 */
export interface AppError {
  source: ErrorSource;
  kind: ErrorKind;
  code: string; // Can be ERROR_CODES or client-only codes (string)
  message: string;
  retryAfterSeconds?: number;
  canRetry: boolean;
  actionHint: ActionHint;
  debug?: {
    status?: number;
    url?: string;
    details?: unknown;
  };
}

/**
 * Context for getUserFacingMessage
 */
export interface ErrorContext {
  domain: 'chat' | 'matching' | 'reporting';
  action: string; // e.g., 'send-message', 'create-availability', 'match-decision'
  role?: 'rider' | 'pro' | 'admin';
}

/**
 * User-facing error message
 */
export interface UserMessage {
  title: string;
  text: string;
  severity: Severity;
  canRetry: boolean;
  retryAfterSeconds?: number;
  actionHint?: ActionHint;
}
