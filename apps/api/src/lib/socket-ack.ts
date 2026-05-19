import { z } from 'zod';
import { ERROR_CODES } from '../utils/error-codes';
import { secureLogger } from '../utils/secure-logger';

export const ackErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.object({
      code: z.nativeEnum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .strict();

export const ackSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) => {
  const strictDataSchema = dataSchema instanceof z.ZodObject ? (dataSchema.strict() as unknown as T) : dataSchema;
  return z
    .object({
      ok: z.literal(true),
      data: strictDataSchema.optional(),
    })
    .strict();
};

export const ackSuccessSchemaRequired = <T extends z.ZodTypeAny>(dataSchema: T) => {
  const strictDataSchema = dataSchema instanceof z.ZodObject ? (dataSchema.strict() as unknown as T) : dataSchema;
  return z
    .object({
      ok: z.literal(true),
      data: strictDataSchema,
    })
    .strict();
};

export type AckError = z.infer<typeof ackErrorSchema>;

export type AckResult<T> = { ok: true; data?: T } | AckError;

export function createAckOnce(ack?: unknown) {
  let called = false;
  const inner = typeof ack === 'function' ? (ack as (payload: AckResult<unknown>) => void) : () => {};
  return (payload: AckResult<unknown>) => {
    if (called) {
      if (process.env.NODE_ENV !== 'production') {
        secureLogger.warn('SOCKET_ACK_DUPLICATE_IGNORED');
      }
      return;
    }
    called = true;
    inner(payload);
  };
}
