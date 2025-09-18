import { z } from 'zod';

export const createAvailabilitySchema = z.object({
  sport: z.enum(['surf', 'kitesurf']),
  levels: z.array(z.enum(['beginner', 'intermediate', 'advanced'])).min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  capacity: z.number().int().positive().max(20).optional(),
  spotName: z.string().min(1).max(120).optional(),
  spotLat: z.number().min(-90).max(90).optional(),
  spotLng: z.number().min(-180).max(180).optional(),
  price: z.number().nonnegative().max(9999).optional(),
});

export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;
