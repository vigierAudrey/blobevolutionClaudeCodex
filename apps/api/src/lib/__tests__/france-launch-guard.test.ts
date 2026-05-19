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

describe('france-launch-guard — pré-filtres et cas limites géographiques', () => {
  // NaN / Infinity ne doivent jamais passer le guard
  it('rejette les coordonnées non finies (NaN, Infinity)', () => {
    expect(isFranceLaunchCoordinate(NaN, 2.3522)).toBe(false);
    expect(isFranceLaunchCoordinate(48.8566, NaN)).toBe(false);
    expect(isFranceLaunchCoordinate(Infinity, 2.3522)).toBe(false);
    expect(isFranceLaunchCoordinate(48.8566, -Infinity)).toBe(false);
  });

  // Alsace : Strasbourg doit être accepté (polygone ALSACE_POLYGON couvre lng jusqu'à 7.8)
  it('accepte Strasbourg / Alsace (lng ~7.75, hors polygon mainland mais couvert par ALSACE_POLYGON)', () => {
    expect(isFranceLaunchCoordinate(48.5734, 7.7521)).toBe(true);
  });

  // Alpes : Grenoble doit être accepté (polygone ALPS_POLYGON)
  it('accepte Grenoble / Alpes (couvert par ALPS_POLYGON)', () => {
    expect(isFranceLaunchCoordinate(45.1885, 5.7245)).toBe(true);
  });

  // Corse : villes clés — le rectangle conservatoire couvre toute la Corse
  it('accepte les villes corses (Ajaccio, Bonifacio, Porto-Vecchio, Bastia)', () => {
    expect(isFranceLaunchCoordinate(41.9192, 8.7386)).toBe(true);  // Ajaccio
    expect(isFranceLaunchCoordinate(41.39, 9.16)).toBe(true);      // Bonifacio (régression bloquée)
    expect(isFranceLaunchCoordinate(41.593, 9.279)).toBe(true);    // Porto-Vecchio
    expect(isFranceLaunchCoordinate(42.703, 9.450)).toBe(true);    // Bastia
  });

  // Exclusion Genève — centre-ville explicitement exclu
  it('rejette le centre de Genève (exclusion box)', () => {
    expect(isFranceLaunchCoordinate(46.2044, 6.1432)).toBe(false);
  });

  // Autres pays clairement hors-France
  it('rejette les capitales étrangères (pré-filtre global)', () => {
    expect(isFranceLaunchCoordinate(41.3851, 2.1734)).toBe(false); // Barcelone
    expect(isFranceLaunchCoordinate(50.8503, 4.3517)).toBe(false); // Bruxelles
    expect(isFranceLaunchCoordinate(51.5072, -0.1276)).toBe(false); // Londres
    expect(isFranceLaunchCoordinate(40.4168, -3.7038)).toBe(false); // Madrid
  });
});
