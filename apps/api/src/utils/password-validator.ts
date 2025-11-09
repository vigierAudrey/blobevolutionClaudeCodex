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
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const LOWERCASE_REGEX = /[a-z]/;
const UPPERCASE_REGEX = /[A-Z]/;
const DIGIT_REGEX = /[0-9]/;
const SPECIAL_CHAR_REGEX = /[^a-zA-Z0-9]/;

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
export type PasswordRequirementId =
  | 'length'
  | 'lowercase'
  | 'uppercase'
  | 'digit'
  | 'special'
  | 'common';

export type PasswordRequirement = {
  id: PasswordRequirementId;
  label: string;
  test: (password: string) => boolean;
  hint?: string;
};

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    id: 'length',
    label: `Entre ${MIN_LENGTH} et ${MAX_LENGTH} caractères`,
    hint: `${MIN_LENGTH} caractères minimum`,
    test: (password) => password.length >= MIN_LENGTH && password.length <= MAX_LENGTH,
  },
  {
    id: 'lowercase',
    label: 'Au moins une lettre minuscule',
    test: (password) => LOWERCASE_REGEX.test(password),
  },
  {
    id: 'uppercase',
    label: 'Au moins une lettre majuscule',
    test: (password) => UPPERCASE_REGEX.test(password),
  },
  {
    id: 'digit',
    label: 'Au moins un chiffre',
    test: (password) => DIGIT_REGEX.test(password),
  },
  {
    id: 'special',
    label: 'Au moins un caractère spécial (!@#$%^&*...)',
    test: (password) => SPECIAL_CHAR_REGEX.test(password),
  },
  {
    id: 'common',
    label: 'Ne pas contenir un mot de passe trop commun',
    hint: 'Évite « password », « azerty »…',
    test: (password) =>
      !COMMON_PASSWORDS.some((common) => password.toLowerCase().includes(common.toLowerCase())),
  },
];

export const passwordSchema = z
  .string()
  .min(MIN_LENGTH, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(MAX_LENGTH, 'Le mot de passe ne peut pas dépasser 128 caractères')
  .regex(LOWERCASE_REGEX, 'Le mot de passe doit contenir au moins une minuscule')
  .regex(UPPERCASE_REGEX, 'Le mot de passe doit contenir au moins une majuscule')
  .regex(DIGIT_REGEX, 'Le mot de passe doit contenir au moins un chiffre')
  .regex(
    SPECIAL_CHAR_REGEX,
    'Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&*...)',
  )
  .refine(
    (password) =>
      !COMMON_PASSWORDS.some((common) => password.toLowerCase().includes(common.toLowerCase())),
    {
      message: 'Ce mot de passe est trop commun et vulnérable aux attaques',
    },
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

export type PasswordRequirementStatus = {
  id: PasswordRequirementId;
  label: string;
  satisfied: boolean;
  hint?: string;
};

export function getPasswordRequirementStatuses(password: string): PasswordRequirementStatus[] {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    hint: requirement.hint,
    satisfied: requirement.test(password),
  }));
}
