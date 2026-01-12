import { getUserFacingMessage } from '../getUserFacingMessage';
import { normalizeAppError } from '../normalizeAppError';
import { ERROR_CODES } from '../socketAck';
import type { ErrorContext } from '../types/appError';

describe('getUserFacingMessage', () => {
  describe('RATE_LIMITED', () => {
    it('shows warning severity with retry hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        retryAfter: 30,
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Trop de tentatives',
        severity: 'warning',
        canRetry: false,
        retryAfterSeconds: 30,
        actionHint: 'retry',
      });
      expect(result.text).toContain('30 seconde');
    });

    it('shows generic message when no retryAfter', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
      });

      const context: ErrorContext = {
        domain: 'matching',
        action: 'search',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.text).toContain('Veuillez patienter');
      expect(result.retryAfterSeconds).toBeUndefined();
    });

    it('pluralizes seconds correctly', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests',
        retryAfter: 1,
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.text).toContain('1 seconde');
      expect(result.text).not.toContain('secondes');
    });
  });

  describe('UNAUTHORIZED / AUTH_FAILED', () => {
    it('shows critical severity with relogin hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Unauthorized',
        status: 401,
      });

      const context: ErrorContext = {
        domain: 'booking',
        action: 'create-availability',
        role: 'pro',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Session expirée',
        text: 'Votre session a expiré. Veuillez vous reconnecter.',
        severity: 'critical',
        canRetry: false,
        actionHint: 'relogin',
      });
    });

    it('handles AUTH_FAILED same as UNAUTHORIZED', () => {
      const err = normalizeAppError({
        code: 'AUTH_FAILED',
        message: 'Auth failed',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'join-conversation',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.title).toBe('Session expirée');
      expect(result.actionHint).toBe('relogin');
    });
  });

  describe('FORBIDDEN', () => {
    it('shows critical severity with contact_support hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Access denied',
        status: 403,
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Accès refusé',
        severity: 'critical',
        canRetry: false,
        actionHint: 'contact_support',
      });
      expect(result.text).toContain('autorisation');
      expect(result.text).toContain('message');
    });

    it('shows context-specific message for booking pro', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Access denied',
      });

      const context: ErrorContext = {
        domain: 'booking',
        action: 'update-availability',
        role: 'pro',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.text).toContain('disponibilité');
    });

    it('shows generic message for unknown context', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Access denied',
      });

      const context: ErrorContext = {
        domain: 'reporting',
        action: 'report-profile',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.text).toContain('effectuer cette action');
    });
  });

  describe('VALIDATION_ERROR', () => {
    it('shows error severity with fix_input hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid input',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Informations invalides',
        severity: 'error',
        canRetry: false,
        actionHint: 'fix_input',
      });
      expect(result.text).toContain('message');
    });

    it('shows context-specific message for booking', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid dates',
      });

      const context: ErrorContext = {
        domain: 'booking',
        action: 'create-availability',
        role: 'pro',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.text).toContain('dates');
      expect(result.text).toContain('lieu');
      expect(result.text).toContain('capacité');
    });

    it('shows context-specific message for matching', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid search',
      });

      const context: ErrorContext = {
        domain: 'matching',
        action: 'search',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.text).toContain('critères');
    });
  });

  describe('UNIQUE_CONSTRAINT', () => {
    it('shows error severity with fix_input hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.UNIQUE_CONSTRAINT,
        message: 'Duplicate',
      });

      const context: ErrorContext = {
        domain: 'booking',
        action: 'create-availability',
        role: 'pro',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Élément déjà existant',
        severity: 'error',
        canRetry: false,
        actionHint: 'fix_input',
      });
      expect(result.text).toContain('disponibilité existe déjà');
    });
  });

  describe('BOOKING_CONFLICT', () => {
    it('shows error severity with fix_input hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.BOOKING_CONFLICT,
        message: 'Conflict',
      });

      const context: ErrorContext = {
        domain: 'booking',
        action: 'decide-request',
        role: 'pro',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Conflit de réservation',
        text: 'Cette disponibilité est déjà réservée ou fermée.',
        severity: 'error',
        canRetry: false,
        actionHint: 'fix_input',
      });
    });
  });

  describe('MATCHING_CONFLICT', () => {
    it('shows error severity with fix_input hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.MATCHING_CONFLICT,
        message: 'Already matched',
      });

      const context: ErrorContext = {
        domain: 'matching',
        action: 'match-decision',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Profil déjà traité',
        text: 'Vous avez déjà traité ce profil.',
        severity: 'error',
        canRetry: false,
        actionHint: 'fix_input',
      });
    });
  });

  describe('INTERNAL_ERROR', () => {
    it('shows warning severity with retry hint', () => {
      const err = normalizeAppError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Server error',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Erreur serveur',
        text: 'Une erreur est survenue sur le serveur. Veuillez réessayer dans un instant.',
        severity: 'warning',
        canRetry: true,
        actionHint: 'retry',
      });
    });
  });

  describe('CLIENT_TIMEOUT', () => {
    it('shows warning severity with retry hint', () => {
      const err = normalizeAppError({
        code: 'CLIENT_TIMEOUT',
        message: 'Timeout',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Délai dépassé',
        severity: 'warning',
        canRetry: true,
        actionHint: 'retry',
      });
      expect(result.text).toContain('message');
    });

    it('shows generic message for non-chat context', () => {
      const err = normalizeAppError({
        code: 'CLIENT_TIMEOUT',
        message: 'Timeout',
      });

      const context: ErrorContext = {
        domain: 'booking',
        action: 'create-availability',
        role: 'pro',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.text).toContain('opération a pris trop de temps');
    });
  });

  describe('NOT_CONNECTED / NO_SOCKET / CONNECT_ERROR', () => {
    it('shows warning severity with retry hint for NOT_CONNECTED', () => {
      const err = normalizeAppError({
        code: 'NOT_CONNECTED',
        message: 'Not connected',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Connexion perdue',
        text: 'Vous êtes hors ligne. Vérifiez votre connexion internet.',
        severity: 'warning',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('shows same message for NO_SOCKET', () => {
      const err = normalizeAppError({
        code: 'NO_SOCKET',
        message: 'No socket',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.title).toBe('Connexion perdue');
      expect(result.text).toContain('hors ligne');
    });

    it('shows different message for CONNECT_ERROR', () => {
      const err = normalizeAppError({
        code: 'CONNECT_ERROR',
        message: 'Connect error',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'join-conversation',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.title).toBe('Connexion perdue');
      expect(result.text).toContain('Impossible de se connecter');
    });
  });

  describe('INVALID_ENVELOPE / INVALID_RESPONSE / INVALID_JSON', () => {
    it('shows warning severity with retry hint', () => {
      const err = normalizeAppError({
        code: 'INVALID_ENVELOPE',
        message: 'Invalid envelope',
      });

      const context: ErrorContext = {
        domain: 'matching',
        action: 'search',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Réponse invalide',
        text: 'Le serveur a renvoyé une réponse invalide. Veuillez réessayer.',
        severity: 'warning',
        canRetry: true,
        actionHint: 'retry',
      });
    });

    it('shows same message for INVALID_RESPONSE', () => {
      const err = normalizeAppError({
        code: 'INVALID_RESPONSE',
        message: 'Invalid response',
      });

      const context: ErrorContext = {
        domain: 'booking',
        action: 'create-availability',
        role: 'pro',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.title).toBe('Réponse invalide');
    });

    it('shows same message for INVALID_JSON', () => {
      const err = normalizeAppError({
        code: 'INVALID_JSON',
        message: 'Invalid JSON',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result.title).toBe('Réponse invalide');
    });
  });

  describe('Unknown codes', () => {
    it('shows generic error message', () => {
      const err = normalizeAppError({
        code: 'UNKNOWN_CODE',
        message: 'Unknown error',
      });

      const context: ErrorContext = {
        domain: 'chat',
        action: 'send-message',
      };

      const result = getUserFacingMessage(err, context);

      expect(result).toMatchObject({
        title: 'Erreur',
        text: 'Une erreur inattendue est survenue. Veuillez réessayer.',
        severity: 'warning', // Unknown codes are classified as transient → warning
        canRetry: true,
        actionHint: 'retry',
      });
    });
  });

  describe('Integration with normalizeAppError', () => {
    it('handles full WS ACK error flow', () => {
      const rawError = {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many messages',
        details: { retryAfter: 15 },
      };

      const normalized = normalizeAppError(rawError);
      const userMsg = getUserFacingMessage(normalized, {
        domain: 'chat',
        action: 'send-message',
      });

      expect(userMsg).toMatchObject({
        title: 'Trop de tentatives',
        severity: 'warning',
        canRetry: false,
        retryAfterSeconds: 15,
        actionHint: 'retry',
      });
      expect(userMsg.text).toContain('15 seconde');
    });

    it('handles full HTTP Strict error flow', () => {
      const rawError = {
        code: ERROR_CODES.FORBIDDEN,
        message: 'Forbidden',
        status: 403,
        url: 'http://localhost:4000/booking/availability/123',
      };

      const normalized = normalizeAppError(rawError);
      const userMsg = getUserFacingMessage(normalized, {
        domain: 'booking',
        action: 'delete-availability',
        role: 'pro',
      });

      expect(userMsg).toMatchObject({
        title: 'Accès refusé',
        severity: 'critical',
        canRetry: false,
        actionHint: 'contact_support',
      });
      expect(userMsg.text).toContain('disponibilité');
    });

    it('handles full client-only error flow', () => {
      const rawError = {
        code: 'CLIENT_TIMEOUT',
        message: 'ACK timeout after 5000ms',
      };

      const normalized = normalizeAppError(rawError);
      const userMsg = getUserFacingMessage(normalized, {
        domain: 'chat',
        action: 'send-message',
      });

      expect(userMsg).toMatchObject({
        title: 'Délai dépassé',
        severity: 'warning',
        canRetry: true,
        actionHint: 'retry',
      });
    });
  });
});
