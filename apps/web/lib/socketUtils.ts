/**
 * Utilitaires WebSocket pour détecter les types d'erreurs
 * ✅ E-REVIEW P0 #2: Détection robuste des erreurs d'authentification
 */

/**
 * Extrait le message d'une erreur Socket.IO (formats variés)
 * Formats supportés:
 * - Error classique: error.message
 * - Objet: { message: string }
 * - Socket.IO: { data: string | { message: string } }
 * - Fallback: String(error)
 */
function extractErrorMessage(error: unknown): string {
  if (!error) return '';

  // Cas 1: Error classique
  if (error instanceof Error && error.message) {
    return error.message;
  }

  // Cas 2: { message: string }
  const errObj = error as { message?: unknown; data?: unknown };
  if (typeof errObj.message === 'string') {
    return errObj.message;
  }

  // Cas 3: Socket.IO { data: string | { message: string } }
  if (errObj.data) {
    if (typeof errObj.data === 'string') {
      return errObj.data;
    }
    if (typeof errObj.data === 'object' && errObj.data !== null) {
      const dataObj = errObj.data as { message?: unknown };
      if (typeof dataObj.message === 'string') {
        return dataObj.message;
      }
    }
  }

  // Fallback: stringify safe
  try {
    return String(error);
  } catch {
    return '';
  }
}

/**
 * Détecte si une erreur connect_error est liée à l'authentification
 *
 * Heuristiques (priorité):
 * 1. Patterns spécifiques auth: '401', 'unauthorized', 'invalid token', 'token expired', 'jwt expired'
 * 2. Patterns contextuels: 'jwt' + 'token/auth', 'expired' + 'token/session', 'forbidden' + 'auth'
 *
 * Anti-faux positifs:
 * - "expired cache" => false
 * - "forbidden channel" => false
 * - "jwt" seul => false
 *
 * @param error - Error object from socket.io connect_error event
 * @returns true if error is auth-related, false otherwise
 */
export function isAuthConnectError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase().trim();
  if (!message) return false;

  // Patterns spécifiques auth (haute priorité)
  const specificAuthPatterns = [
    '401',
    'unauthorized',
    'invalid token',
    'token expired',
    'jwt expired',
    'token invalid',
    'authentication failed',
    'authentication required'
  ];

  if (specificAuthPatterns.some(pattern => message.includes(pattern))) {
    return true;
  }

  // Patterns contextuels (plus larges, nécessitent contexte)
  // "jwt" uniquement si associé à token/auth/invalid
  if (message.includes('jwt') && (
    message.includes('token') ||
    message.includes('auth') ||
    message.includes('invalid')
  )) {
    return true;
  }

  // "expired" uniquement si associé à token/session/jwt/auth
  if (message.includes('expired') && (
    message.includes('token') ||
    message.includes('session') ||
    message.includes('jwt') ||
    message.includes('auth')
  )) {
    return true;
  }

  // "forbidden" uniquement si associé à auth/token
  if (message.includes('forbidden') && (
    message.includes('auth') ||
    message.includes('token')
  )) {
    return true;
  }

  // "access denied" uniquement si associé à auth/token/jwt
  if (message.includes('access denied') && (
    message.includes('auth') ||
    message.includes('token') ||
    message.includes('jwt')
  )) {
    return true;
  }

  return false;
}
