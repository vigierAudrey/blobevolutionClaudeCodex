import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['RIDER', 'PRO']).default('RIDER')
});

export type RegisterInput = z.infer<typeof registerSchema>;

