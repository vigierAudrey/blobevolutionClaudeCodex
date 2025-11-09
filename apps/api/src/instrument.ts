import * as Sentry from '@sentry/node';
import { secureLogger, redactSensitive } from './utils/secure-logger';

const environment = process.env.NODE_ENV || 'development';

// ⚠️ Ne pas initialiser Sentry en environnement test
// Raison : Sentry maintient des connexions TCP ouvertes qui causent des warnings Jest
// et empêchent les tests de se terminer proprement
if (environment !== 'test') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      if (event.user) {
        event.user = redactSensitive(event.user);
      }

      if (event.request) {
        event.request = redactSensitive(event.request);
      }

      if (event.exception?.values) {
        event.exception.values = event.exception.values.map(value => {
          if (value.value) {
            value.value = redactSensitive(value.value);
          }
          return value;
        });
      }

      return event;
    }
  });

  secureLogger.info('SENTRY_INITIALIZED', { environment });
} else {
  // En test, on log juste que Sentry est désactivé
  secureLogger.info('SENTRY_DISABLED_IN_TEST', { environment });
}
