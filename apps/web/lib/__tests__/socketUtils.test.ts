/**
 * Tests unitaires pour socketUtils
 * ✅ E-REVIEW P0 #2: Tests isAuthConnectError()
 */

import { isAuthConnectError } from '../socketUtils';

describe('isAuthConnectError', () => {
  it('should detect 401 errors', () => {
    const error = new Error('Error 401: Unauthorized');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect unauthorized errors', () => {
    const error = new Error('Connection failed: Unauthorized access');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect JWT errors', () => {
    const error = new Error('Invalid JWT token');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect expired token errors', () => {
    const error = new Error('Token has expired');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect authentication errors', () => {
    const error = new Error('Authentication failed');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should NOT detect "403 Forbidden" alone as auth error (403 = authorized but forbidden)', () => {
    const error = new Error('403 Forbidden');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should NOT detect network errors', () => {
    const error = new Error('Network timeout');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should NOT detect connection refused errors', () => {
    const error = new Error('Connection refused');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should handle null/undefined errors', () => {
    expect(isAuthConnectError(null)).toBe(false);
    expect(isAuthConnectError(undefined)).toBe(false);
  });

  it('should handle errors without message property', () => {
    const error = { code: 'ECONNREFUSED' };
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should be case insensitive', () => {
    const error1 = new Error('UNAUTHORIZED');
    const error2 = new Error('UnAutHoRiZeD');
    expect(isAuthConnectError(error1)).toBe(true);
    expect(isAuthConnectError(error2)).toBe(true);
  });

  // Tests pour formats Socket.IO variés
  it('should detect auth error from plain object with message', () => {
    const error = { message: 'Unauthorized' };
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect auth error from Socket.IO data string', () => {
    const error = { data: 'jwt expired' };
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect auth error from Socket.IO data object with context', () => {
    const error = { data: { message: 'JWT expired' } };
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should NOT detect xhr poll error', () => {
    const error = new Error('xhr poll error');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should NOT detect ECONNREFUSED from data string', () => {
    const error = { data: 'ECONNREFUSED' };
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should handle whitespace and trim correctly', () => {
    const error = { message: '  Unauthorized  ' };
    expect(isAuthConnectError(error)).toBe(true);
  });

  // Tests anti-faux positifs (patterns larges)
  it('should NOT detect "expired cache" as auth error', () => {
    const error = new Error('expired cache');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should NOT detect "forbidden channel" as auth error', () => {
    const error = new Error('forbidden channel');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should NOT detect "jwt" alone as auth error', () => {
    const error = new Error('jwt');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should NOT detect "expired" alone as auth error', () => {
    const error = new Error('expired');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should NOT detect "forbidden" alone as auth error', () => {
    const error = new Error('forbidden');
    expect(isAuthConnectError(error)).toBe(false);
  });

  // Tests contextuels (patterns larges AVEC contexte auth)
  it('should detect "jwt token invalid" as auth error', () => {
    const error = new Error('jwt token invalid');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect "session expired" as auth error', () => {
    const error = new Error('session expired');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect "auth token expired" as auth error', () => {
    const error = new Error('auth token expired');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect "forbidden auth" as auth error', () => {
    const error = new Error('forbidden auth');
    expect(isAuthConnectError(error)).toBe(true);
  });

  // Tests "access denied" (contextuel uniquement)
  it('should NOT detect "access denied" alone as auth error', () => {
    const error = new Error('access denied');
    expect(isAuthConnectError(error)).toBe(false);
  });

  it('should detect "access denied - invalid token" as auth error', () => {
    const error = new Error('access denied - invalid token');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect "access denied: jwt required" as auth error', () => {
    const error = new Error('access denied: jwt required');
    expect(isAuthConnectError(error)).toBe(true);
  });

  it('should detect "access denied - authentication failed" as auth error', () => {
    const error = new Error('access denied - authentication failed');
    expect(isAuthConnectError(error)).toBe(true);
  });
});
