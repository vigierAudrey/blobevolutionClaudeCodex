import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['RIDER', 'PRO']).default('RIDER'),
  ageConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez avoir 18 ans ou plus pour vous inscrire.' }),
  }),
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Vous devez accepter la charte et l\'avertissement.' }),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
