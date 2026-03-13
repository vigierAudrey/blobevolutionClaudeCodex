import { z } from 'zod';

export const prosNearbySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().int().positive().max(200).default(25),
  sport: z.enum(['surf', 'kitesurf']).optional(),
});

export type ProsNearbyInput = z.infer<typeof prosNearbySchema>;

export const nearbyProSchema = z.object({
  proPublicId: z.string().uuid(),
  businessName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  verified: z.boolean(),
  distanceBucket: z.enum(['<5km', '5-15km', '15-30km', '>30km']),
  sports: z.array(z.enum(['surf', 'kitesurf'])),
  openAvailabilityCount: z.number().int().nonnegative(),
});

export type NearbyProOutput = z.infer<typeof nearbyProSchema>;
