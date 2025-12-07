type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'security';

const REDACTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/(Bearer\s+)([^\s]+)/gi, '$1[REDACTED]'],
  [/((?:^|[\s"'`])token(?:Id)?(?:=|:)\s*)([^\s"'`&,]+)/gi, '$1[REDACTED]'],
  [/((?:^|[\s"'`])(access[_-]?token|refresh[_-]?token)(?:=|:)\s*)([^\s"'`&,]+)/gi, '$1[REDACTED]'],
  [/((?:^|[\s"'`])authorization(?:=|:)\s*)([^\s"'`&,]+)/gi, '$1[REDACTED]'],
  [/((?:^|[\s"'`])email(?:=|:)\s*)([^\s"'`&,]+)/gi, '$1[REDACTED]']
];

const SENSITIVE_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'password',
  'email',
  'verificationtoken',
  'resettoken'
]);

function sanitizeString(value: string): string {
  let sanitized = value;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function sanitizeValue<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string | symbol, unknown>).map(([key, val]) => {
      if (typeof key === 'string' && SENSITIVE_KEYS.has(key.toLowerCase())) {
        return [key, '[REDACTED]'];
      }
      return [key, sanitizeValue(val)];
    });
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function log(level: LogLevel, event: string, context?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const sanitizedEvent = sanitizeString(event);
  const sanitizedContext = context ? sanitizeValue(context) : undefined;

  const consoleMethod =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug'
          ? console.debug
          : console.info;

  if (sanitizedContext) {
    consoleMethod(`[${timestamp}] ${level.toUpperCase()} ${sanitizedEvent}`, sanitizedContext);
  } else {
    consoleMethod(`[${timestamp}] ${level.toUpperCase()} ${sanitizedEvent}`);
  }
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
  return sanitizeValue(value);
}
