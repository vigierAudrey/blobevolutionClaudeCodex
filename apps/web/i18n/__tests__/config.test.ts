import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, isLocale, resolveLocale } from '../config';

describe('i18n config', () => {
  it('expose les 5 locales supportées avec le français par défaut', () => {
    expect(LOCALES).toEqual(['fr', 'en', 'es', 'de', 'nl']);
    expect(DEFAULT_LOCALE).toBe('fr');
    expect(LOCALE_COOKIE).toBe('NEXT_LOCALE');
  });

  describe('isLocale', () => {
    it.each(['fr', 'en', 'es', 'de', 'nl'])('accepte "%s"', (value) => {
      expect(isLocale(value)).toBe(true);
    });

    it.each(['FR', 'it', 'fr-FR', '', ' fr', 'français', 42, null, undefined, {}])(
      'rejette %p',
      (value) => {
        expect(isLocale(value)).toBe(false);
      },
    );
  });

  describe('resolveLocale', () => {
    it('retourne la locale quand la valeur du cookie est valide', () => {
      expect(resolveLocale('en')).toBe('en');
      expect(resolveLocale('nl')).toBe('nl');
    });

    it('retombe sur le français pour toute valeur absente ou forgée', () => {
      expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
      expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
      expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
      expect(resolveLocale('zz')).toBe(DEFAULT_LOCALE);
      expect(resolveLocale('../../etc/passwd')).toBe(DEFAULT_LOCALE);
      expect(resolveLocale('fr.json')).toBe(DEFAULT_LOCALE);
    });
  });
});
