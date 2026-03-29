import { describe, expect, it } from '@jest/globals';
import {
  FRANCE_ONLY_COUNTRY_CODE,
  FRANCE_ONLY_SCOPE_MESSAGE,
  assertFranceLaunchLocation,
  assertFranceLaunchProProfile,
  isFranceLaunchCoordinate,
} from '../france-launch-guard';

describe('france-launch-guard', () => {
  it('accepts France mainland and Corsica coordinates', () => {
    expect(isFranceLaunchCoordinate(48.8566, 2.3522)).toBe(true);
    expect(isFranceLaunchCoordinate(41.9192, 8.7386)).toBe(true);
  });

  it('rejects non-France coordinates near the border', () => {
    expect(isFranceLaunchCoordinate(46.2044, 6.1432)).toBe(false);
    expect(() => assertFranceLaunchLocation({ lat: 46.2044, lng: 6.1432 })).toThrow(FRANCE_ONLY_SCOPE_MESSAGE);
  });

  it('requires FR for professional profiles', () => {
    expect(() => assertFranceLaunchProProfile({})).toThrow('Le pays du compte professionnel doit être renseigné');
    expect(() => assertFranceLaunchProProfile({ countryCode: 'CH' })).toThrow(FRANCE_ONLY_SCOPE_MESSAGE);
  });

  it('rejects incomplete coordinate pairs', () => {
    expect(() =>
      assertFranceLaunchProProfile({ countryCode: FRANCE_ONLY_COUNTRY_CODE, lat: 48.8566 }),
    ).toThrow('La latitude et la longitude doivent être fournies ensemble.');
  });

  it('returns the normalized FR country code for valid professional profiles', () => {
    expect(
      assertFranceLaunchProProfile({
        countryCode: 'fr',
        lat: 43.4832,
        lng: -1.5586,
      }),
    ).toBe(FRANCE_ONLY_COUNTRY_CODE);
  });
});
