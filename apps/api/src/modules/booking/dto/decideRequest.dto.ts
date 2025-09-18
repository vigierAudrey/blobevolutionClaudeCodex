import { z } from 'zod';

const actionEnum = z.enum(['accept', 'reject']);
const decisionEnum = z.enum(['ACCEPT', 'REJECT']);

export const decideBookingRequestSchema = z
  .object({
    action: actionEnum.optional(),
    decision: decisionEnum.optional(),
  })
  .refine((value) => value.action || value.decision, {
    message: 'Either action or decision must be provided',
    path: ['action'],
  })
  .transform((value) => {
    if (value.action) {
      return { action: value.action } as const;
    }
    const normalized = value.decision === 'ACCEPT' ? 'accept' : 'reject';
    return { action: normalized } as const;
  });

export type DecideBookingRequestInput = z.infer<typeof decideBookingRequestSchema>;
