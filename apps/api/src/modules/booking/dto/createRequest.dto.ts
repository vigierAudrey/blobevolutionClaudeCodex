import { z } from 'zod';

export const createBookingRequestSchema = z.object({
  availabilityId: z.string().uuid(),
  message: z.string().max(500).optional(),
});

export type CreateBookingRequestInput = z.infer<typeof createBookingRequestSchema>;
