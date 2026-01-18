import { z } from 'zod';
import { ackErrorSchema, type ErrorCode } from './socketAck';

/**
 * Minimal socket interface for emitWithAck (enables testing without Socket type assertion)
 */
export interface SocketEmitter {
  emit(event: string, ...args: unknown[]): void;
}

export type EmitWithAckOptions = {
  timeoutMs?: number;
};

export type AckResultError = {
  code: ErrorCode | 'CLIENT_TIMEOUT';
  message: string;
  details?: unknown;
};

/**
 * Convert any error value to a safe, serializable details object.
 * Prevents crashes from circular references, getters, or proxies.
 */
function toSafeDetails(err: unknown): unknown {
  if (err === null || err === undefined) return err;
  if (typeof err === 'string' || typeof err === 'number' || typeof err === 'boolean') {
    return err;
  }

  // ZodError special case
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as { issues: unknown }).issues)) {
    try {
      return { issues: (err as z.ZodError).issues };
    } catch {
      // fallback if accessing issues throws
    }
  }

  // Error objects
  if (err instanceof Error) {
    try {
      return {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    } catch {
      return String(err);
    }
  }

  // Generic objects: shallow copy (max 10 keys) with safe access
  if (typeof err === 'object') {
    try {
      const safe: Record<string, unknown> = {};
      const keys = Object.keys(err).slice(0, 10);
      for (const key of keys) {
        try {
          const value: unknown = (err as Record<string, unknown>)[key];
          // Detect circular references: if value === err (self-reference)
          if (value === err) {
            safe[key] = '<circular>';
          } else if (value !== null && typeof value === 'object') {
            // Nested object: don't deep copy to avoid complexity, just mark as object
            safe[key] = '<object>';
          } else {
            // Primitive value: safe to copy
            safe[key] = value;
          }
        } catch {
          safe[key] = '<inaccessible>';
        }
      }
      return safe;
    } catch {
      // If Object.keys throws or copy fails, fallback to string
    }
  }

  // Fallback: stringify
  try {
    return String(err);
  } catch {
    return '<unserializable>';
  }
}

/**
 * Normalize ACK callback arguments into a single value.
 * - 0 args => undefined
 * - 1 arg => ackArgs[0]
 * - >1 args => prefer first ack-like object (has ok:true/false or error), else return array
 *
 * Ultra-safe: uses Object.getOwnPropertyDescriptor to detect ack-like objects,
 * and validates that accessing properties doesn't throw before returning.
 */
function normalizeAck(ackArgs: unknown[]): unknown {
  if (ackArgs.length === 0) return undefined;
  if (ackArgs.length === 1) return ackArgs[0];

  // Multiple args: try to find an ack-like object
  for (const arg of ackArgs) {
    if (arg !== null && typeof arg === 'object') {
      try {
        // Safe detection: check if 'ok' or 'error' property exists without triggering getters
        const okDesc = Object.getOwnPropertyDescriptor(arg, 'ok');
        const errorDesc = Object.getOwnPropertyDescriptor(arg, 'error');

        // If either descriptor exists (value or getter), verify access doesn't throw
        if (okDesc !== undefined || errorDesc !== undefined) {
          // Try to access the property to ensure getter doesn't throw
          const obj = arg as Record<string, unknown>;
          if (okDesc !== undefined) {
            // Access ok property (will trigger getter if present)
            void obj.ok;
          }
          if (errorDesc !== undefined) {
            // Access error property (will trigger getter if present)
            void obj.error;
          }
          // If we reach here, accessing properties didn't throw
          return arg;
        }
      } catch {
        // If descriptor access or property access throws (malicious proxy/getter), skip this arg
        continue;
      }
    }
  }

  // No ack-like object found, return the array (will likely fail Zod validation)
  return ackArgs;
}

/**
 * Emit a Socket.IO event and await a typed ACK.
 * - Validates ACK with Zod schemas.
 * - Missing/invalid ACK or timeout => throws with code CLIENT_TIMEOUT or INTERNAL_ERROR.
 * - Ultra-hardened: emit() can throw, normalizeAck is safe, details are serializable.
 */
export async function emitWithAck<T>(
  socket: SocketEmitter | null,
  event: string,
  payload: unknown,
  successSchema: z.ZodType<{ ok: true; data: T }>,
  opts: EmitWithAckOptions = {}
): Promise<T> {
  if (!socket) {
    const error: AckResultError = { code: 'CLIENT_TIMEOUT', message: 'Socket not connected' };
    throw error;
  }

  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer: ReturnType<typeof setTimeout> = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject({ code: 'CLIENT_TIMEOUT', message: `ACK timeout after ${timeoutMs}ms` } satisfies AckResultError);
    }, timeoutMs);

    const finish = <V>(fn: (value: V) => void, value: V) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      fn(value);
    };

    // Wrap emit() in try/catch: emit itself can throw (e.g., transport error)
    try {
      socket.emit(event, payload, (...ackArgs: unknown[]) => {
        try {
          const normalizedAck = normalizeAck(ackArgs);

          // First try error schema
          const maybeError = ackErrorSchema.safeParse(normalizedAck);
          if (maybeError.success) {
            return finish(reject, {
              code: maybeError.data.error.code,
              message: maybeError.data.error.message,
              details: toSafeDetails(maybeError.data.error.details),
            } satisfies AckResultError);
          }

          const success = successSchema.parse(normalizedAck);
          return finish(resolve, success.data);
        } catch (err) {
          return finish(
            reject,
            {
              code: 'INTERNAL_ERROR',
              message: err instanceof Error ? err.message : 'Invalid ACK',
              details: toSafeDetails(err),
            } satisfies AckResultError
          );
        }
      });
    } catch (err) {
      // emit() itself threw (transport error, socket closed, etc.)
      return finish(
        reject,
        {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'emit failed',
          details: toSafeDetails(err),
        } satisfies AckResultError
      );
    }
  });
}
