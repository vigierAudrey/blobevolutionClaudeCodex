import * as Sentry from '@sentry/node';
import { secureLogger, redactSensitive } from './utils/secure-logger';

const environment = process.env.NODE_ENV || 'development';

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
