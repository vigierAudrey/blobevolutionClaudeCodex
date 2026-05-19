import { z } from 'zod';

export const registerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['RIDER', 'PRO']).default('RIDER'),
    countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
    ageConfirmed: z.literal(true, {
      errorMap: () => ({ message: 'Vous devez avoir 18 ans ou plus pour vous inscrire.' }),
    }),
    consentAccepted: z.literal(true, {
      errorMap: () => ({ message: 'Vous devez accepter la charte et l\'avertissement.' }),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'PRO' && !value.countryCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['countryCode'],
        message: 'Le pays du compte professionnel doit être renseigné et fixé à FR.',
      });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;
