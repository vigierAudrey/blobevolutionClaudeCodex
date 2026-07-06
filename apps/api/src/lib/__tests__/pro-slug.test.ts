/**
 * Tests for pro public slug generation + publicCity validation
 */

import {
  slugifyBusinessName,
  generateUniqueProSlug,
  validatePublicCity,
  RESERVED_SLUGS,
  MAX_SLUG_LENGTH,
  PUBLIC_CITY_MAX_LENGTH,
} from '../pro-slug';

describe('pro-slug', () => {
  describe('slugifyBusinessName()', () => {
    it('slugifies a plain business name', () => {
      expect(slugifyBusinessName('Blob Surf School')).toBe('blob-surf-school');
    });

    it('strips accents and apostrophes', () => {
      expect(slugifyBusinessName("École de surf d'Hélène à Capbreton")).toBe(
        'ecole-de-surf-d-helene-a-capbreton',
      );
    });

    it('collapses symbols and repeated separators into single hyphens', () => {
      expect(slugifyBusinessName('  Surf & Kite -- Lacanau !!')).toBe('surf-kite-lacanau');
    });

    it('returns null when nothing usable remains', () => {
      expect(slugifyBusinessName('')).toBeNull();
      expect(slugifyBusinessName('   ')).toBeNull();
      expect(slugifyBusinessName('!!! ###')).toBeNull();
      expect(slugifyBusinessName('🏄🌊')).toBeNull();
      expect(slugifyBusinessName('a')).toBeNull();
    });

    it('rejects reserved route words', () => {
      for (const reserved of ['Admin', 'pros', 'LOGIN', 'sitemap']) {
        expect(slugifyBusinessName(reserved)).toBeNull();
      }
      expect(RESERVED_SLUGS.has('admin')).toBe(true);
    });

    it('truncates long names without leaving a trailing hyphen', () => {
      const slug = slugifyBusinessName(`${'ab '.repeat(40)}fin`);
      expect(slug).not.toBeNull();
      expect(slug!.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
      expect(slug!.endsWith('-')).toBe(false);
    });
  });

  describe('generateUniqueProSlug()', () => {
    it('returns the plain base when it is free', async () => {
      const slug = await generateUniqueProSlug('Blob Surf School', async () => false);
      expect(slug).toBe('blob-surf-school');
    });

    it('appends a short random suffix on collision', async () => {
      const isTaken = jest
        .fn<Promise<boolean>, [string]>()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      const slug = await generateUniqueProSlug('Blob Surf School', isTaken);
      expect(slug).toMatch(/^blob-surf-school-[0-9a-f]{4}$/);
      expect(isTaken).toHaveBeenCalledTimes(2);
    });

    it('throws on a business name that yields no slug', async () => {
      await expect(generateUniqueProSlug('!!!', async () => false)).rejects.toThrow(
        'SLUG_INVALID_BUSINESS_NAME',
      );
    });

    it('throws when every candidate is taken', async () => {
      await expect(generateUniqueProSlug('Blob Surf School', async () => true)).rejects.toThrow(
        'SLUG_GENERATION_EXHAUSTED',
      );
    });
  });

  describe('validatePublicCity()', () => {
    it('accepts real French city names', () => {
      expect(validatePublicCity('Lacanau')).toBe('Lacanau');
      expect(validatePublicCity('Vieux-Boucau-les-Bains')).toBe('Vieux-Boucau-les-Bains');
      expect(validatePublicCity("L'Île-d'Yeu")).toBe("L'Île-d'Yeu");
      expect(validatePublicCity('Saint-Jean-de-Luz')).toBe('Saint-Jean-de-Luz');
    });

    it('trims and collapses inner whitespace', () => {
      expect(validatePublicCity('  Le   Porge  ')).toBe('Le Porge');
    });

    it('rejects too-short and too-long values', () => {
      expect(validatePublicCity('A')).toBeNull();
      expect(validatePublicCity('a'.repeat(PUBLIC_CITY_MAX_LENGTH + 1))).toBeNull();
    });

    it('rejects markup, URLs and address-like punctuation', () => {
      expect(validatePublicCity('<script>alert(1)</script>')).toBeNull();
      expect(validatePublicCity('https://spam.example')).toBeNull();
      expect(validatePublicCity('Lacanau, 12 rue du Port')).toBeNull();
      expect(validatePublicCity('Lacanau (Océan)')).toBeNull();
    });
  });
});
