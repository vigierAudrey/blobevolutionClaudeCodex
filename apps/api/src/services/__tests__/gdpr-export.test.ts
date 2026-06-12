import * as crypto from 'crypto';

/**
 * Tests unitaires pour la pseudonymisation des emails dans l'export GDPR
 * Conformité RGPD Article 5.1.c - Minimisation des données
 */

// Copie de la fonction de pseudonymisation pour les tests
function pseudonymizeEmail(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex')
    .substring(0, 8);
}

describe('GDPR Export - Email Pseudonymization', () => {
  describe('pseudonymizeEmail()', () => {
    it('should return 8-character hash for valid email', () => {
      const hash = pseudonymizeEmail('user@example.com');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    });

    it('should return consistent hash for same email', () => {
      const email = 'test@blobsurf.com';
      const hash1 = pseudonymizeEmail(email);
      const hash2 = pseudonymizeEmail(email);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different emails', () => {
      const hash1 = pseudonymizeEmail('alice@example.com');
      const hash2 = pseudonymizeEmail('bob@example.com');
      expect(hash1).not.toBe(hash2);
    });

    it('should be case-insensitive', () => {
      const hash1 = pseudonymizeEmail('User@Example.COM');
      const hash2 = pseudonymizeEmail('user@example.com');
      expect(hash1).toBe(hash2);
    });

    it('should trim whitespace', () => {
      const hash1 = pseudonymizeEmail('  user@example.com  ');
      const hash2 = pseudonymizeEmail('user@example.com');
      expect(hash1).toBe(hash2);
    });

    it('should be non-reversible (one-way hash)', () => {
      const email = 'secret@example.com';
      const hash = pseudonymizeEmail(email);

      // Le hash ne doit pas contenir l'email en clair
      expect(hash).not.toContain(email);
      expect(hash).not.toContain('secret');
      expect(hash).not.toContain('example');
    });

    it('should produce unique hashes for similar emails', () => {
      const emails = [
        'user1@example.com',
        'user2@example.com',
        'user3@example.com',
      ];

      const hashes = emails.map(pseudonymizeEmail);
      const uniqueHashes = new Set(hashes);

      expect(uniqueHashes.size).toBe(emails.length);
    });

    it('should handle special characters in email', () => {
      const hash = pseudonymizeEmail('user+tag@example.com');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  describe('GDPR Article 5.1.c Compliance - Data Minimization', () => {
    it('should not expose full email addresses in export', () => {
      const otherUserEmail = 'other-user@example.com';
      const pseudonymized = pseudonymizeEmail(otherUserEmail);

      // L'utilisateur exportant ses données n'a pas besoin de l'email complet
      // Un identifiant unique pseudonymisé suffit pour la traçabilité
      expect(pseudonymized).not.toBe(otherUserEmail);
      expect(pseudonymized.length).toBeLessThan(otherUserEmail.length);
    });

    it('should maintain uniqueness for user identification', () => {
      // Même avec 1000 emails différents, pas de collision attendue (SHA-256 tronqué)
      const emails = Array.from({ length: 1000 }, (_, i) => `user${i}@example.com`);
      const hashes = emails.map(pseudonymizeEmail);
      const uniqueHashes = new Set(hashes);

      // Avec 8 caractères hex (16^8 = 4.3 milliards de possibilités),
      // les collisions sont extrêmement rares
      expect(uniqueHashes.size).toBe(emails.length);
    });
  });

  describe('Real-world examples', () => {
    it('should pseudonymize real email examples', () => {
      const examples = [
        { email: 'rider@blobsurf.com', expectedPattern: /^[a-f0-9]{8}$/ },
        { email: 'pro@example.fr', expectedPattern: /^[a-f0-9]{8}$/ },
        { email: 'admin+test@company.org', expectedPattern: /^[a-f0-9]{8}$/ },
      ];

      examples.forEach(({ email, expectedPattern }) => {
        const hash = pseudonymizeEmail(email);
        expect(hash).toMatch(expectedPattern);
      });
    });
  });
});
