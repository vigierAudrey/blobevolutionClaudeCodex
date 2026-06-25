/**
 * Maps known server-side English error messages to French user-facing messages.
 * Never surfaces raw server messages to the user — all unmapped messages fall
 * back to a generic neutral string so English leaks don't reach the UI.
 */
export function mapAuthErrorToFrench(message: string): string {
  const n = message.toLowerCase();

  // Invalid credentials — neutral phrasing prevents account enumeration
  if (n.includes('invalid credentials') || n.includes('invalid password') || n.includes('user not found')) {
    return 'Email ou mot de passe incorrect.';
  }

  // Rate limit — registration
  if (n.includes('too many registration') || n.includes('registration_rate_limit')) {
    return 'Trop de tentatives. Réessaie dans quelques minutes.';
  }

  // Rate limit — authentication / generic auth
  if (
    n.includes('too many authentication') ||
    n.includes('auth_rate_limit') ||
    n.includes('too many login') ||
    (n.includes('too many') && n.includes('attempt'))
  ) {
    return 'Trop de tentatives de connexion. Réessaie plus tard.';
  }

  // Rate limit — generic 429
  if (n.includes('too many requests') || n.includes('too many') || n.includes('rate limit')) {
    return 'Trop de tentatives. Réessaie plus tard.';
  }

  // Payload too large (413)
  if (n.includes('payload too large') || n.includes('request entity too large') || n.includes('too large')) {
    return 'Le fichier ou la demande est trop volumineux.';
  }

  // Generic invalid input (not Zod-detailed)
  if (n === 'invalid input') {
    return 'Certaines informations sont invalides.';
  }

  // Unrecognised server message — never show it raw
  return 'Une erreur est survenue. Réessaie ou contacte le support.';
}
