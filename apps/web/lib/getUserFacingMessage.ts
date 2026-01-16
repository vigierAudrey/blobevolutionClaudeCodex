import type { AppError } from './types/appError';
import type { ErrorContext, UserMessage, Severity } from './types/appError';
import { ERROR_CODES } from './socketAck';

/**
 * Map error code to severity
 */
function getSeverity(code: string, kind: AppError['kind']): Severity {
  // RATE_LIMITED: warning
  if (code === ERROR_CODES.RATE_LIMITED) {
    return 'warning';
  }

  // Client-only errors: info or warning
  if (kind === 'client_only') {
    return code === 'AUTH_FAILED' ? 'error' : 'warning';
  }

  // UNAUTHORIZED, FORBIDDEN: critical
  if (code === ERROR_CODES.UNAUTHORIZED || code === ERROR_CODES.FORBIDDEN) {
    return 'critical';
  }

  // VALIDATION_ERROR, conflicts: error
  if (
    code === ERROR_CODES.VALIDATION_ERROR ||
    code === ERROR_CODES.UNIQUE_CONSTRAINT ||
    code === ERROR_CODES.BOOKING_CONFLICT ||
    code === ERROR_CODES.MATCHING_CONFLICT
  ) {
    return 'error';
  }

  // Transient errors: warning
  if (kind === 'transient') {
    return 'warning';
  }

  // Default: error
  return 'error';
}

/**
 * Get user-facing title for error code
 */
function getTitle(code: string, _context: ErrorContext): string {

  switch (code) {
    case ERROR_CODES.RATE_LIMITED:
      return 'Trop de tentatives';

    case ERROR_CODES.UNAUTHORIZED:
    case 'AUTH_FAILED':
      return 'Session expirée';

    case ERROR_CODES.FORBIDDEN:
      return 'Accès refusé';

    case ERROR_CODES.VALIDATION_ERROR:
      return 'Informations invalides';

    case ERROR_CODES.UNIQUE_CONSTRAINT:
      return 'Élément déjà existant';

    case ERROR_CODES.BOOKING_CONFLICT:
      return 'Conflit de réservation';

    case ERROR_CODES.MATCHING_CONFLICT:
      return 'Profil déjà traité';

    case ERROR_CODES.INTERNAL_ERROR:
      return 'Erreur serveur';

    case 'CLIENT_TIMEOUT':
      return 'Délai dépassé';

    case 'NOT_CONNECTED':
    case 'NO_SOCKET':
    case 'CONNECT_ERROR':
      return 'Connexion perdue';

    case 'INVALID_ENVELOPE':
    case 'INVALID_RESPONSE':
    case 'INVALID_JSON':
      return 'Réponse invalide';

    default:
      return 'Erreur';
  }
}

/**
 * Get user-facing text for error code
 */
function getText(code: string, context: ErrorContext, retryAfterSeconds?: number): string {
  const { domain, action, role } = context;

  switch (code) {
    case ERROR_CODES.RATE_LIMITED:
      if (retryAfterSeconds) {
        return `Vous avez effectué trop de tentatives. Réessayez dans ${retryAfterSeconds} seconde${retryAfterSeconds > 1 ? 's' : ''}.`;
      }
      return 'Vous avez effectué trop de tentatives. Veuillez patienter avant de réessayer.';

    case ERROR_CODES.UNAUTHORIZED:
    case 'AUTH_FAILED':
      return 'Votre session a expiré. Veuillez vous reconnecter.';

    case ERROR_CODES.FORBIDDEN:
      if (domain === 'chat' && action === 'send-message') {
        return 'Vous n\'avez pas l\'autorisation d\'envoyer des messages à ce contact.';
      }
      if (domain === 'booking' && role === 'pro') {
        return 'Vous n\'avez pas l\'autorisation de modifier cette disponibilité.';
      }
      return 'Vous n\'avez pas l\'autorisation d\'effectuer cette action.';

    case ERROR_CODES.VALIDATION_ERROR:
      if (domain === 'chat') {
        return 'Le message ne peut pas être vide ou dépasse la longueur maximale.';
      }
      if (domain === 'booking') {
        return 'Vérifiez les informations saisies (dates, lieu, capacité).';
      }
      if (domain === 'matching') {
        return 'Vérifiez les critères de recherche.';
      }
      return 'Veuillez vérifier les informations saisies.';

    case ERROR_CODES.UNIQUE_CONSTRAINT:
      if (domain === 'booking') {
        return 'Une disponibilité existe déjà pour cette période.';
      }
      return 'Cet élément existe déjà.';

    case ERROR_CODES.BOOKING_CONFLICT:
      return 'Cette disponibilité est déjà réservée ou fermée.';

    case ERROR_CODES.MATCHING_CONFLICT:
      return 'Vous avez déjà traité ce profil.';

    case ERROR_CODES.INTERNAL_ERROR:
      return 'Une erreur est survenue sur le serveur. Veuillez réessayer dans un instant.';

    case 'CLIENT_TIMEOUT':
      if (domain === 'chat' && action === 'send-message') {
        return 'Le message n\'a pas pu être envoyé dans le délai imparti. Veuillez réessayer.';
      }
      return 'L\'opération a pris trop de temps. Veuillez réessayer.';

    case 'NOT_CONNECTED':
    case 'NO_SOCKET':
      return 'Vous êtes hors ligne. Vérifiez votre connexion internet.';

    case 'CONNECT_ERROR':
      return 'Impossible de se connecter au serveur. Vérifiez votre connexion internet.';

    case 'INVALID_ENVELOPE':
    case 'INVALID_RESPONSE':
    case 'INVALID_JSON':
      return 'Le serveur a renvoyé une réponse invalide. Veuillez réessayer.';

    default:
      return 'Une erreur inattendue est survenue. Veuillez réessayer.';
  }
}

/**
 * Get user-facing message from normalized AppError
 *
 * Maps error codes to user-friendly title + text, with context-aware messages.
 *
 * @param appErr - Normalized AppError from normalizeAppError
 * @param context - Context for domain/action/role-specific messages
 * @returns User-facing message with title, text, severity, and action hints
 */
export function getUserFacingMessage(appErr: AppError, context: ErrorContext): UserMessage {
  const severity = getSeverity(appErr.code, appErr.kind);
  const title = getTitle(appErr.code, context);
  const text = getText(appErr.code, context, appErr.retryAfterSeconds);

  return {
    title,
    text,
    severity,
    canRetry: appErr.canRetry,
    retryAfterSeconds: appErr.retryAfterSeconds,
    actionHint: appErr.actionHint,
  };
}
