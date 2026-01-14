import { Socket } from 'socket.io-client';
import { z } from 'zod';
import { ackErrorSchema, ackSuccessSchemaRequired, type ErrorCode } from './socketAck';

export type EmitWithAckOptions = {
  timeoutMs?: number;
};

export type AckResultError = {
  code: ErrorCode | 'CLIENT_TIMEOUT';
  message: string;
  details?: unknown;
};

/**
 * Emit a Socket.IO event and await a typed ACK.
 * - Validates ACK with Zod schemas.
 * - Missing/invalid ACK or timeout => throws with code CLIENT_TIMEOUT or INTERNAL_ERROR.
 */
export async function emitWithAck<T>(
  socket: Socket | null,
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
  const safeSetTimeout =
    typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout.bind(globalThis)
      : typeof window !== 'undefined' && typeof window.setTimeout === 'function'
        ? window.setTimeout.bind(window)
        : null;

  const safeClearTimeout = (id: ReturnType<typeof setTimeout>) => {
    if (typeof globalThis !== 'undefined' && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(id);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
      window.clearTimeout(id as unknown as number);
    }
  };

  return new Promise<T>((resolve, reject) => {
    if (!safeSetTimeout) {
      reject({ code: 'CLIENT_TIMEOUT', message: 'Timer unavailable' } satisfies AckResultError);
      return;
    }

    let settled = false;
    const timer = safeSetTimeout(() => {
      if (settled) return;
      settled = true;
      safeClearTimeout(timer as unknown as ReturnType<typeof setTimeout>);
      reject({ code: 'CLIENT_TIMEOUT', message: `ACK timeout after ${timeoutMs}ms` } satisfies AckResultError);
    }, timeoutMs);

    const finish = (fn: (value?: any) => void, value: any) => {
      if (settled) return;
      settled = true;
      safeClearTimeout(timer as unknown as ReturnType<typeof setTimeout>);
      fn(value);
    };

    socket.emit(event, payload, (ack: unknown) => {
      try {
        // First try error schema
        const maybeError = ackErrorSchema.safeParse(ack);
        if (maybeError.success) {
          return finish(reject, {
            code: maybeError.data.error.code,
            message: maybeError.data.error.message,
            details: maybeError.data.error.details,
          } satisfies AckResultError);
        }

        const success = successSchema.parse(ack);
        return finish(resolve, success.data);
      } catch (err) {
        return finish(
          reject,
          {
            code: 'CLIENT_TIMEOUT',
            message: err instanceof Error ? err.message : 'Invalid ACK',
            details: err,
          } satisfies AckResultError
        );
      }
    });
  });
}
