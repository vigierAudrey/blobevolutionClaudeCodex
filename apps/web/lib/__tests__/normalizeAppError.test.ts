import { normalizeAppError } from '../normalizeAppError';
import { ERROR_CODES } from '../socketAck';

describe('normalizeAppError', () => {
  describe('WS ACK errors', () => {
    it('normalizes CLIENT_TIMEOUT from emitWithAck', () => {
      const err = {
        code: 'CLIENT_TIMEOUT',
        message: 'ACK timeout after 5000ms',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'WS_ACK',
        kind: 'client_only',
        code: 'CLIENT_TIMEOUT',
        message: 'ACK timeout after 5000ms',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes RATE_LIMITED with retryAfter from WS ACK', () => {
      const err = {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        details: { retryAfter: 30 },
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'WS_CHANNEL', // Has ERROR_CODE but no status/url
        kind: 'transient',
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        retryAfterSeconds: 30,
        canRetry: false, // User must wait
        actionHint: 'retry',
      });
    });

    it('extracts retryAfter from top-level', () => {
      const err = {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        retryAfter: 60,
      };

      const result = normalizeAppError(err);

      expect(result.retryAfterSeconds).toBe(60);
    });

    it('prefers top-level retryAfter over details.retryAfter', () => {
      const err = {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        retryAfter: 60,
        details: { retryAfter: 30 },
      };

      const result = normalizeAppError(err);

      expect(result.retryAfterSeconds).toBe(60);
    });

    it('normalizes FORBIDDEN from WS ACK', () => {
      const err = {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Access denied',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'permanent',
        code: ERROR_CODES.FORBIDDEN,
        canRetry: false,
        actionHint: 'contact_support',
      });
    });
  });

  describe('WS channel errors', () => {
    it('normalizes socket-error with ERROR_CODE', () => {
      const err = {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Server error',
        details: { stack: 'trace' },
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'WS_CHANNEL',
        kind: 'transient',
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Server error',
        canRetry: true,
        actionHint: 'retry',
      });
      expect(result.debug?.details).toEqual({ stack: 'trace' });
    });

    it('normalizes VALIDATION_ERROR from socket-error', () => {
      const err = {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid payload',
        details: { field: 'content', issue: 'too long' },
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'permanent',
        code: ERROR_CODES.VALIDATION_ERROR,
        canRetry: false,
        actionHint: 'fix_input',
      });
    });
  });

  describe('HTTP Strict errors', () => {
    it('normalizes StrictHttpError with status and url', () => {
      const err = {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Access denied',
        status: 403,
        url: 'http://localhost:4000/conversations/abc/messages',
        details: { reason: 'blocked' },
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'HTTP_STRICT',
        kind: 'permanent',
        code: ERROR_CODES.FORBIDDEN,
        message: 'Access denied',
        canRetry: false,
        actionHint: 'contact_support',
      });
      expect(result.debug?.status).toBe(403);
      expect(result.debug?.url).toBe('http://localhost:4000/conversations/abc/messages');
      expect(result.debug?.details).toEqual({ reason: 'blocked' });
    });

    it('normalizes UNAUTHORIZED with relogin hint', () => {
      const err = {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Unauthorized',
        status: 401,
        url: 'http://localhost:4000/auth/me',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'permanent',
        code: ERROR_CODES.UNAUTHORIZED,
        canRetry: false,
        actionHint: 'relogin',
      });
    });

    it('normalizes UNIQUE_CONSTRAINT', () => {
      const err = {
        code: ERROR_CODES.UNIQUE_CONSTRAINT,
        message: 'Duplicate entry',
        status: 409,
        url: 'http://localhost:4000/booking/availability',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'permanent',
        code: ERROR_CODES.UNIQUE_CONSTRAINT,
        canRetry: false,
        actionHint: 'fix_input',
      });
    });

    it('normalizes BOOKING_CONFLICT', () => {
      const err = {
        code: ERROR_CODES.BOOKING_CONFLICT,
        message: 'Booking conflict',
        status: 409,
        url: 'http://localhost:4000/booking/requests/123/decision',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'permanent',
        code: ERROR_CODES.BOOKING_CONFLICT,
        canRetry: false,
        actionHint: 'fix_input',
      });
    });

    it('normalizes MATCHING_CONFLICT', () => {
      const err = {
        code: ERROR_CODES.MATCHING_CONFLICT,
        message: 'Already matched',
        status: 409,
        url: 'http://localhost:4000/matching/decision',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'permanent',
        code: ERROR_CODES.MATCHING_CONFLICT,
        canRetry: false,
        actionHint: 'fix_input',
      });
    });

    it('normalizes INVALID_ENVELOPE', () => {
      const err = {
        code: 'INVALID_ENVELOPE',
        message: 'Missing enveloped response body',
        status: 200,
        url: 'http://localhost:4000/conversations/open',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'HTTP_STRICT',
        kind: 'client_only',
        code: 'INVALID_ENVELOPE',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes INVALID_JSON', () => {
      const err = {
        code: 'INVALID_JSON',
        message: 'Response is not valid JSON',
        status: 200,
        url: 'http://localhost:4000/matching/search',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'client_only',
        code: 'INVALID_JSON',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes INVALID_RESPONSE', () => {
      const err = {
        code: 'INVALID_RESPONSE',
        message: 'Failed to read response body',
        status: 500,
        url: 'http://localhost:4000/booking/availability',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'transient',
        code: 'INVALID_RESPONSE',
        canRetry: true,
        actionHint: 'retry',
      });
    });
  });

  describe('Client-only errors', () => {
    it('normalizes NOT_CONNECTED', () => {
      const err = {
        code: 'NOT_CONNECTED',
        message: 'Socket not connected',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'WS_ACK',
        kind: 'client_only',
        code: 'NOT_CONNECTED',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes NO_SOCKET', () => {
      const err = {
        code: 'NO_SOCKET',
        message: 'Socket instance not available',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'client_only',
        code: 'NO_SOCKET',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes AUTH_FAILED with relogin hint', () => {
      const err = {
        code: 'AUTH_FAILED',
        message: 'Session expired, please login again',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'client_only',
        code: 'AUTH_FAILED',
        canRetry: false,
        actionHint: 'relogin',
      });
    });

    it('normalizes CONNECT_ERROR', () => {
      const err = {
        code: 'CONNECT_ERROR',
        message: 'Connection failed',
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        kind: 'client_only',
        code: 'CONNECT_ERROR',
        canRetry: true,
        actionHint: 'retry',
      });
    });
  });

  describe('Legacy Error', () => {
    it('normalizes Error instance without code', () => {
      const err = new Error('Something went wrong');

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'HTTP_LEGACY',
        kind: 'transient',
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes Error with custom properties', () => {
      const err = new Error('Unauthorized') as Error & { status: number };
      err.status = 401;

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'HTTP_STRICT', // Has status
        code: 'INTERNAL_ERROR', // No code property
      });
      expect(result.debug?.status).toBe(401);
    });
  });

  describe('Unknown errors', () => {
    it('normalizes string error', () => {
      const err = 'Something bad happened';

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'UNKNOWN',
        kind: 'transient',
        code: 'INTERNAL_ERROR',
        message: 'Something bad happened',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes null error', () => {
      const err = null;

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'UNKNOWN',
        kind: 'transient',
        code: 'INTERNAL_ERROR',
        message: 'Unknown error',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes undefined error', () => {
      const err = undefined;

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'UNKNOWN',
        kind: 'transient',
        code: 'INTERNAL_ERROR',
        message: 'Unknown error',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('normalizes object without code or message', () => {
      const err = { foo: 'bar' };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'UNKNOWN',
        kind: 'transient',
        code: 'INTERNAL_ERROR',
        canRetry: true,
        actionHint: 'retry',
      });
    });
  });

  describe('Never throws', () => {
    it('handles error during normalization gracefully', () => {
      const err = {
        get code() {
          throw new Error('Boom!');
        },
      };

      const result = normalizeAppError(err);

      expect(result).toMatchObject({
        source: 'UNKNOWN',
        kind: 'transient',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('handles circular reference', () => {
      const err: { code: string; message: string; circular?: unknown } = { code: ERROR_CODES.INTERNAL_ERROR, message: 'Error' };
      err.circular = err;

      // Should not throw, even if debug info can't be serialized
      const result = normalizeAppError(err);

      expect(result.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });
  });

  describe('Edge cases', () => {
    it('ignores zero retryAfter', () => {
      const err = {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Rate limited',
        retryAfter: 0,
      };

      const result = normalizeAppError(err);

      expect(result.retryAfterSeconds).toBeUndefined();
    });

    it('ignores negative retryAfter', () => {
      const err = {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Rate limited',
        retryAfter: -10,
      };

      const result = normalizeAppError(err);

      expect(result.retryAfterSeconds).toBeUndefined();
    });

    it('ignores non-number retryAfter', () => {
      const err = {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Rate limited',
        retryAfter: 'soon',
      };

      const result = normalizeAppError(err);

      expect(result.retryAfterSeconds).toBeUndefined();
    });

    it('handles empty debug object', () => {
      const err = {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Error',
      };

      const result = normalizeAppError(err);

      expect(result.debug).toBeUndefined();
    });

    it('includes debug when details present', () => {
      const err = {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid',
        details: { field: 'email' },
      };

      const result = normalizeAppError(err);

      expect(result.debug?.details).toEqual({ field: 'email' });
    });
  });
});
