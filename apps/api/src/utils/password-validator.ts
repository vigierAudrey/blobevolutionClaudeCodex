import { z } from 'zod';

/**
 * Password Validation Schema - OWASP Compliant
 *
 * Security requirements (P1-3):
 * - Minimum 8 characters, maximum 128
 * - At least one lowercase letter
 * - At least one uppercase letter
 * - At least one digit
 * - At least one special character
 * - Not in common passwords blacklist
 *
 * References:
 * - OWASP A07:2021 – Identification and Authentication Failures
 * - CWE-521: Weak Password Requirements
 * - READMESECURITY.md P1-3 (lines 117-170)
 */

/**
 * Common passwords blacklist (French + English)
 * Source: Top 100 most common passwords + French variations
 */
const COMMON_PASSWORDS = [
  // English common
  'password',
  'Password',
  'Password1',
  'Password123',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'iloveyou',

  // French common
  'motdepasse',
  'Motdepasse',
  'Motdepasse1',
  'azerty',
  'azerty123',
  'bonjour',
  'Bonjour1',
  'bienvenue',
  'marseille',
  'soleil',

  // Keyboard patterns
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1qaz2wsx',

  // Generic weak
  'admin',
  'Admin123',
  'root',
  'Root123',
  'user',
  'User123',
];

/**
 * Password validation schema with OWASP-compliant rules
 *
 * @example
 * ```typescript
 * import { passwordSchema } from './utils/password-validator';
 *
 * const schema = z.object({
 *   password: passwordSchema,
 * });
 * ```
 */
export const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères')
  .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule')
  .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule')
  .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre')
  .regex(
    /[^a-zA-Z0-9]/,
    'Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*...)'
  )
  .refine(
    (password) =>
      !COMMON_PASSWORDS.some((common) =>
        password.toLowerCase().includes(common.toLowerCase())
      ),
    {
      message: 'Ce mot de passe est trop commun et vulnérable aux attaques',
    }
  );

/**
 * Type-safe password string validated against OWASP rules
 */
export type ValidatedPassword = z.infer<typeof passwordSchema>;

/**
 * Validate a password against OWASP requirements
 *
 * @param password - Password to validate
 * @returns Validation result with detailed errors
 *
 * @example
 * ```typescript
 * const result = validatePassword('weak');
 * if (!result.success) {
 *   console.error(result.error.errors);
 * }
 * ```
 */
export function validatePassword(password: string) {
  return passwordSchema.safeParse(password);
}

/**
 * Check if password meets minimum strength requirements
 * Useful for UI feedback without detailed error messages
 *
 * @param password - Password to check
 * @returns true if password is valid
 */
export function isStrongPassword(password: string): boolean {
  return passwordSchema.safeParse(password).success;
}
