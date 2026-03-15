import { getLogContext } from '../observability/log-context';
import { sanitizeLogString, serializeLogValue } from '../observability/log-serializer';
import { enqueueLogEntry, type LogLevel } from '../observability/log-transport';

function log(level: LogLevel, event: string, context?: Record<string, unknown>) {
  const isTestEnv = process.env.NODE_ENV === 'test';
  const allowTestLogs = process.env.ENABLE_TEST_LOGS === 'true';
  const shouldLog =
    allowTestLogs ||
    !isTestEnv ||
    level === 'error' ||
    level === 'warn' ||
    level === 'security';
  if (!shouldLog) return;

  const sanitizedEvent = sanitizeLogString(event);
  const sanitizedContext = context ? serializeLogValue(context) as Record<string, unknown> : undefined;
  const logContext = getLogContext();
  enqueueLogEntry({
    timestamp: new Date().toISOString(),
    level,
    event: sanitizedEvent,
    requestId: logContext.requestId,
    actorRef: logContext.actorRef,
    source: logContext.source,
    ...(logContext.routeOrJob ? { routeOrJob: logContext.routeOrJob } : {}),
    ...(sanitizedContext && Object.keys(sanitizedContext).length > 0
      ? { context: sanitizedContext }
      : {}),
  });
}

export const secureLogger = {
  debug(event: string, context?: Record<string, unknown>) {
    log('debug', event, context);
  },
  info(event: string, context?: Record<string, unknown>) {
    log('info', event, context);
  },
  warn(event: string, context?: Record<string, unknown>) {
    log('warn', event, context);
  },
  error(event: string, context?: Record<string, unknown>) {
    log('error', event, context);
  },
  security(event: string, context?: Record<string, unknown>) {
    log('security', event, context);
  }
};

export function redactSensitive<T>(value: T): T {
  return serializeLogValue(value) as T;
}
