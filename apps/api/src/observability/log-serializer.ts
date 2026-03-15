import { Buffer } from 'buffer';
import { isIP } from 'node:net';
import { createActorRef } from './log-context';

const REDACTED = '[REDACTED]';
const REDACTED_IP = '[REDACTED_IP]';
const CIRCULAR = '[Circular]';
const TRUNCATED = '[Truncated]';
const GETTER = '[Getter]';
const MAX_DEPTH = 5;
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_BUFFER_PREVIEW_BYTES = 32;
const MAX_KEY_LENGTH = 120;

const DIRECT_REDACTION_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'token',
  'tokenid',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'secret',
  'session',
  'email',
  'ip',
  'xforwardedfor',
  'clientip',
  'forwardedfor',
  'useragentraw',
]);

const USER_IDENTIFIER_KEYS = [
  'userid',
  'adminid',
  'actorid',
  'senderid',
  'recipientid',
  'targetuserid',
  'authenticateduserid',
  'createdbyid',
  'prouserid',
  'rideruserid',
];

const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f-\u009f]/g;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi;
const TOKEN_VALUE_REGEX = /\b(?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|authorization|cookie)\s*[:=]\s*([^\s,;]+)/gi;
const INLINE_IP_CANDIDATE_REGEX = /\[?[A-Fa-f0-9:.%]{2,}\]?/g;

type SerializationState = {
  seen: WeakSet<object>;
};

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const sanitizeControlChars = (value: string): string =>
  value.replace(CONTROL_CHARS_REGEX, ' ');

const truncateString = (value: string): string =>
  value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}` : value;

function redactInlineIp(match: string): string {
  const bare = match.startsWith('[') && match.endsWith(']') ? match.slice(1, -1) : match;
  const zoneSeparatorIndex = bare.indexOf('%');
  const candidate = zoneSeparatorIndex === -1 ? bare : bare.slice(0, zoneSeparatorIndex);

  if (isIP(candidate) === 0) {
    return match;
  }

  return REDACTED_IP;
}

export function sanitizeLogString(value: string): string {
  const scrubbed = sanitizeControlChars(value)
    .replace(BEARER_REGEX, 'Bearer [REDACTED]')
    .replace(TOKEN_VALUE_REGEX, (_match, tokenValue: string) => _match.replace(tokenValue, REDACTED))
    .replace(EMAIL_REGEX, REDACTED)
    .replace(INLINE_IP_CANDIDATE_REGEX, redactInlineIp);

  return truncateString(scrubbed);
}

function sanitizeKeyName(key: string): string {
  return truncateString(sanitizeControlChars(key).slice(0, MAX_KEY_LENGTH));
}

function shouldRedactKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized.endsWith('hash') || normalized.endsWith('ref')) {
    return false;
  }
  return DIRECT_REDACTION_KEYS.has(normalized);
}

function shouldPseudonymizeUserIdentifier(key: string): boolean {
  const normalized = normalizeKey(key);
  return USER_IDENTIFIER_KEYS.some((candidate) => normalized.endsWith(candidate));
}

function serializeError(value: Error, depth: number, state: SerializationState) {
  const serializedOwnProps = serializeObject(value, depth, state);
  return {
    name: sanitizeLogString(value.name),
    message: sanitizeLogString(value.message),
    ...(value.stack ? { stack: sanitizeLogString(value.stack) } : {}),
    ...(typeof serializedOwnProps === 'object' && serializedOwnProps !== null
      ? serializedOwnProps
      : { details: serializedOwnProps }),
  };
}

function serializeBuffer(value: Buffer) {
  const preview = value.subarray(0, MAX_BUFFER_PREVIEW_BYTES).toString('hex');
  return {
    type: 'Buffer',
    byteLength: value.byteLength,
    preview,
    truncated: value.byteLength > MAX_BUFFER_PREVIEW_BYTES,
  };
}

function serializeArray(value: unknown[], depth: number, state: SerializationState): unknown[] {
  const items = value.slice(0, MAX_ARRAY_LENGTH).map((item) => serializeLogValue(item, depth + 1, state));
  if (value.length > MAX_ARRAY_LENGTH) {
    items.push(`[${value.length - MAX_ARRAY_LENGTH} more items truncated]`);
  }
  return items;
}

function serializeObject(
  value: object,
  depth: number,
  state: SerializationState,
): Record<string, unknown> | string {
  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  if (state.seen.has(value)) {
    return CIRCULAR;
  }

  state.seen.add(value);

  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const selectedKeys = keys.slice(0, MAX_OBJECT_KEYS);
    const result: Record<string, unknown> = {};

    for (const key of selectedKeys) {
      const descriptor = descriptors[key];
      const safeKey = sanitizeKeyName(key);

      if (!descriptor.enumerable) {
        continue;
      }

      if (shouldRedactKey(key)) {
        result[safeKey] = REDACTED;
        continue;
      }

      if (!('value' in descriptor)) {
        result[safeKey] = GETTER;
        continue;
      }

      if (shouldPseudonymizeUserIdentifier(key) && typeof descriptor.value === 'string') {
        result[safeKey] = createActorRef(descriptor.value);
        continue;
      }

      result[safeKey] = serializeLogValue(descriptor.value, depth + 1, state);
    }

    if (keys.length > MAX_OBJECT_KEYS) {
      result.__truncatedKeys = keys.length - MAX_OBJECT_KEYS;
    }

    return result;
  } catch {
    return '[UnserializableObject]';
  } finally {
    state.seen.delete(value);
  }
}

export function serializeLogValue(
  value: unknown,
  depth = 0,
  state: SerializationState = { seen: new WeakSet<object>() },
): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeLogString(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (Buffer.isBuffer(value)) {
    return serializeBuffer(value);
  }

  if (Array.isArray(value)) {
    return serializeArray(value, depth, state);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[InvalidDate]' : value.toISOString();
  }

  if (value instanceof Error) {
    return serializeError(value, depth, state);
  }

  if (value instanceof Map) {
    return serializeArray(
      Array.from(value.entries()).map(([key, entryValue]) => ({ key, value: entryValue })),
      depth,
      state,
    );
  }

  if (value instanceof Set) {
    return serializeArray(Array.from(value.values()), depth, state);
  }

  if (ArrayBuffer.isView(value)) {
    return `[${value.constructor.name} length=${value.byteLength}]`;
  }

  if (value instanceof ArrayBuffer) {
    return `[ArrayBuffer byteLength=${value.byteLength}]`;
  }

  if (typeof value === 'object') {
    return serializeObject(value, depth, state);
  }

  return sanitizeLogString(String(value));
}
