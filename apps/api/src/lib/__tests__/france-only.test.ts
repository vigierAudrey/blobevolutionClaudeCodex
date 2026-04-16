import {
  FRANCE_ONLY_MESSAGES,
  assertFranceCoordinates,
  assertFranceOnlyProLocation,
  isFranceCoordinatePair,
  normalizeCountryCode,
} from '../france-only';

describe('france-only helper', () => {
  it('normalizes country codes', () => {
    expect(normalizeCountryCode(' fr ')).toBe('FR');
    expect(normalizeCountryCode('')).toBeNull();
    expect(normalizeCountryCode(undefined)).toBeNull();
  });

  it('accepts representative points in metropolitan France and Corsica', () => {
    expect(isFranceCoordinatePair(48.8566, 2.3522)).toBe(true);
    expect(isFranceCoordinatePair(43.4832, -1.5586)).toBe(true);
    expect(isFranceCoordinatePair(43.7102, 7.262)).toBe(true);
    expect(isFranceCoordinatePair(41.9192, 8.7386)).toBe(true);
  });

  it('rejects representative points outside France', () => {
    expect(isFranceCoordinatePair(41.3851, 2.1734)).toBe(false);
    expect(isFranceCoordinatePair(50.8503, 4.3517)).toBe(false);
    expect(isFranceCoordinatePair(46.2044, 6.1432)).toBe(false);
    expect(isFranceCoordinatePair(51.5072, -0.1276)).toBe(false);
  });

  it('throws for non-french coordinates', () => {
    expect(() =>
      assertFranceCoordinates(
        { lat: 41.3851, lng: 2.1734 },
        FRANCE_ONLY_MESSAGES.matchingSearch,
      ),
    ).toThrow(FRANCE_ONLY_MESSAGES.matchingSearch);
  });

  it('requires FR for pro locations and cross-checks coordinates when present', () => {
    expect(() =>
      assertFranceOnlyProLocation(
        { countryCode: 'ES' },
        FRANCE_ONLY_MESSAGES.proProfile,
      ),
    ).toThrow(FRANCE_ONLY_MESSAGES.proProfile);

    expect(() =>
      assertFranceOnlyProLocation(
        { countryCode: 'FR', lat: 41.3851, lng: 2.1734 },
        FRANCE_ONLY_MESSAGES.proProfile,
      ),
    ).toThrow(FRANCE_ONLY_MESSAGES.proProfile);

    expect(() =>
      assertFranceOnlyProLocation(
        { countryCode: 'FR', lat: 43.4832, lng: -1.5586 },
        FRANCE_ONLY_MESSAGES.proProfile,
      ),
    ).not.toThrow();
  });
});
