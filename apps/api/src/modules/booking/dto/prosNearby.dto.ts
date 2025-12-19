import { z } from 'zod';

export const prosNearbySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().int().positive().max(200).default(25),
  sport: z.enum(['surf', 'kitesurf']).optional(),
});

export type ProsNearbyInput = z.infer<typeof prosNearbySchema>;
