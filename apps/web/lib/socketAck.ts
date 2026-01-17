import { z } from 'zod';

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNIQUE_CONSTRAINT: 'UNIQUE_CONSTRAINT',
  BOOKING_CONFLICT: 'BOOKING_CONFLICT',
  MATCHING_CONFLICT: 'MATCHING_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

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

export const ackSuccessSchemaOptional = <T extends z.ZodTypeAny>(dataSchema: T) => {
  const strictDataSchema = dataSchema instanceof z.ZodObject ? dataSchema.strict() : dataSchema;
  return z
    .object({
      ok: z.literal(true),
      data: strictDataSchema.optional(),
    })
    .strict();
};

export const ackSuccessSchemaRequired = <T extends z.ZodTypeAny>(dataSchema: T) => {
  const strictDataSchema = dataSchema instanceof z.ZodObject ? dataSchema.strict() : dataSchema;
  return z
    .object({
      ok: z.literal(true),
      data: strictDataSchema,
    })
    .strict();
};

export type AckError = z.infer<typeof ackErrorSchema>;
