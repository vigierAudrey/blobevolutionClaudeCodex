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
 * Normalize ACK callback arguments into a single value.
 * - 0 args => undefined
 * - 1 arg => ackArgs[0]
 * - >1 args => prefer first ack-like object (has ok:true/false or error), else return array
 */
function normalizeAck(ackArgs: unknown[]): unknown {
  if (ackArgs.length === 0) return undefined;
  if (ackArgs.length === 1) return ackArgs[0];

  // Multiple args: try to find an ack-like object
  for (const arg of ackArgs) {
    if (arg !== null && typeof arg === 'object') {
      const obj = arg as Record<string, unknown>;
      if ('ok' in obj || 'error' in obj) {
        return arg;
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

    socket.emit(event, payload, (...ackArgs: unknown[]) => {
      try {
        const normalizedAck = normalizeAck(ackArgs);

        // First try error schema
        const maybeError = ackErrorSchema.safeParse(normalizedAck);
        if (maybeError.success) {
          return finish(reject, {
            code: maybeError.data.error.code,
            message: maybeError.data.error.message,
            details: maybeError.data.error.details,
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
            details: err,
          } satisfies AckResultError
        );
      }
    });
  });
}
