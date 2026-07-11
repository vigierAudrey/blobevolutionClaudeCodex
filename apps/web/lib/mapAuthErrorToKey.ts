/**
 * Maps known server-side English error messages to a translation key under
 * `auth.errors.*`. Never surfaces raw server messages to the user — all
 * unmapped messages fall back to a generic key so English leaks don't reach
 * the UI, quelle que soit la langue affichée.
 */
export type AuthErrorKey =
  | 'invalidCredentials'
  | 'rateLimitRegistration'
  | 'rateLimitLogin'
  | 'rateLimitGeneric'
  | 'payloadTooLarge'
  | 'invalidInput'
  | 'serverGeneric';

export function mapAuthErrorToKey(message: string): AuthErrorKey {
  const n = message.toLowerCase();

  // Invalid credentials — neutral phrasing prevents account enumeration
  if (n.includes('invalid credentials') || n.includes('invalid password') || n.includes('user not found')) {
    return 'invalidCredentials';
  }

  // Rate limit — registration
  if (n.includes('too many registration') || n.includes('registration_rate_limit')) {
    return 'rateLimitRegistration';
  }

  // Rate limit — authentication / generic auth
  if (
    n.includes('too many authentication') ||
    n.includes('auth_rate_limit') ||
    n.includes('too many login') ||
    (n.includes('too many') && n.includes('attempt'))
  ) {
    return 'rateLimitLogin';
  }

  // Rate limit — generic 429
  if (n.includes('too many requests') || n.includes('too many') || n.includes('rate limit')) {
    return 'rateLimitGeneric';
  }

  // Payload too large (413)
  if (n.includes('payload too large') || n.includes('request entity too large') || n.includes('too large')) {
    return 'payloadTooLarge';
  }

  // Generic invalid input (not Zod-detailed)
  if (n === 'invalid input') {
    return 'invalidInput';
  }

  // Unrecognised server message — never show it raw
  return 'serverGeneric';
}
