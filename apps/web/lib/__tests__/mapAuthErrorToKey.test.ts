import { mapAuthErrorToKey } from '../mapAuthErrorToKey';
import { mapAuthErrorToFrench } from '../mapAuthErrorToFrench';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

describe('mapAuthErrorToKey', () => {
  it.each([
    ['Invalid credentials', 'invalidCredentials'],
    ['INVALID PASSWORD', 'invalidCredentials'],
    ['User not found', 'invalidCredentials'],
    ['Too many registration attempts', 'rateLimitRegistration'],
    ['registration_rate_limit', 'rateLimitRegistration'],
    ['Too many authentication attempts', 'rateLimitLogin'],
    ['auth_rate_limit', 'rateLimitLogin'],
    ['too many login attempts', 'rateLimitLogin'],
    ['Too many requests', 'rateLimitGeneric'],
    ['rate limit exceeded', 'rateLimitGeneric'],
    ['Payload too large', 'payloadTooLarge'],
    ['request entity too large', 'payloadTooLarge'],
    ['Invalid input', 'invalidInput'],
  ] as const)('classe "%s" → %s', (message, expected) => {
    expect(mapAuthErrorToKey(message)).toBe(expected);
  });

  it('ne laisse jamais fuiter un message serveur inconnu (fallback générique)', () => {
    expect(mapAuthErrorToKey('ECONNREFUSED 127.0.0.1:4000')).toBe('serverGeneric');
    expect(mapAuthErrorToKey('Internal server error: stack trace…')).toBe('serverGeneric');
    expect(mapAuthErrorToKey('')).toBe('serverGeneric');
  });

  it('chaque clé retournable existe dans toutes les langues (fr/en)', () => {
    const keys = [
      'invalidCredentials',
      'rateLimitRegistration',
      'rateLimitLogin',
      'rateLimitGeneric',
      'payloadTooLarge',
      'invalidInput',
      'serverGeneric',
    ] as const;
    for (const key of keys) {
      expect(typeof fr.auth.errors[key]).toBe('string');
      expect(typeof en.auth.errors[key]).toBe('string');
    }
  });

  it('mapAuthErrorToFrench reste aligné sur fr.json (source de vérité unique)', () => {
    expect(mapAuthErrorToFrench('Invalid credentials')).toBe(fr.auth.errors.invalidCredentials);
    expect(mapAuthErrorToFrench('mystère total')).toBe(fr.auth.errors.serverGeneric);
  });
});
