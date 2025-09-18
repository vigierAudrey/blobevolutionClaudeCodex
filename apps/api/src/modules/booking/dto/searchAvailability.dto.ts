import { z } from 'zod';

export const searchAvailabilitySchema = z.object({
  sport: z.enum(['surf', 'kitesurf']),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().int().min(1).max(150),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(50).optional().default(20),
});

export type SearchAvailabilityInput = z.infer<typeof searchAvailabilitySchema>;
