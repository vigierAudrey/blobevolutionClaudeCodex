import { mapAuthErrorToFrench } from '../mapAuthErrorToFrench';

describe('mapAuthErrorToFrench', () => {
  describe('Invalid credentials', () => {
    it('maps "Invalid credentials"', () => {
      expect(mapAuthErrorToFrench('Invalid credentials')).toBe('Email ou mot de passe incorrect.');
    });

    it('maps "Invalid password"', () => {
      expect(mapAuthErrorToFrench('Invalid password')).toBe('Email ou mot de passe incorrect.');
    });

    it('maps "User not found"', () => {
      expect(mapAuthErrorToFrench('User not found')).toBe('Email ou mot de passe incorrect.');
    });

    it('is case-insensitive', () => {
      expect(mapAuthErrorToFrench('INVALID CREDENTIALS')).toBe('Email ou mot de passe incorrect.');
    });
  });

  describe('Rate limit — registration', () => {
    it('maps "Too many registration attempts. Please try again later."', () => {
      expect(mapAuthErrorToFrench('Too many registration attempts. Please try again later.')).toBe(
        "Trop de tentatives d'inscription. Réessaie plus tard.",
      );
    });
  });

  describe('Rate limit — authentication', () => {
    it('maps "Too many authentication attempts. Please try again later."', () => {
      expect(mapAuthErrorToFrench('Too many authentication attempts. Please try again later.')).toBe(
        'Trop de tentatives de connexion. Réessaie plus tard.',
      );
    });

    it('maps "Too many login attempts"', () => {
      expect(mapAuthErrorToFrench('Too many login attempts')).toBe(
        'Trop de tentatives de connexion. Réessaie plus tard.',
      );
    });
  });

  describe('Rate limit — generic', () => {
    it('maps "Too many requests. Please slow down."', () => {
      expect(mapAuthErrorToFrench('Too many requests. Please slow down.')).toBe(
        'Trop de tentatives. Réessaie plus tard.',
      );
    });

    it('maps generic rate limit message', () => {
      expect(mapAuthErrorToFrench('rate limit exceeded')).toBe('Trop de tentatives. Réessaie plus tard.');
    });
  });

  describe('Payload too large', () => {
    it('maps "Payload too large"', () => {
      expect(mapAuthErrorToFrench('Payload too large')).toBe('Le fichier ou la demande est trop volumineux.');
    });

    it('maps "Request entity too large"', () => {
      expect(mapAuthErrorToFrench('Request entity too large')).toBe('Le fichier ou la demande est trop volumineux.');
    });
  });

  describe('Invalid input', () => {
    it('maps exact "Invalid input"', () => {
      expect(mapAuthErrorToFrench('Invalid input')).toBe('Certaines informations sont invalides.');
    });
  });

  describe('Unknown messages — fallback', () => {
    it('returns a neutral French fallback for unrecognised messages', () => {
      const result = mapAuthErrorToFrench('Some unexpected server error in English');
      expect(result).not.toContain('Some unexpected server error');
      expect(result).toMatch(/[Ee]rreur|support/);
    });

    it('never returns the raw English message', () => {
      const raw = 'Internal Server Error: connection refused at 127.0.0.1:5432';
      const result = mapAuthErrorToFrench(raw);
      expect(result).not.toContain('connection refused');
      expect(result).not.toContain('127.0.0.1');
    });
  });
});
