import { ERROR_CODES } from '../utils/error-codes';

export const FRANCE_ONLY_COUNTRY_CODE = 'FR';
export const FRANCE_ONLY_SCOPE_MESSAGE =
  'Le lancement initial est temporairement limité à la France métropolitaine et à la Corse.';

type CoordinatePair = { lat: number; lng: number };

type FranceLaunchGuardErrorCode =
  | (typeof ERROR_CODES.FRANCE_ONLY_COUNTRY_REQUIRED)
  | (typeof ERROR_CODES.FRANCE_ONLY_INCOMPLETE_LOCATION)
  | (typeof ERROR_CODES.FRANCE_ONLY_RESTRICTED);

type FranceLaunchLocationInput = {
  lat?: number | null;
  lng?: number | null;
};

export type FranceLaunchGuardError = Error & {
  status: number;
  code: FranceLaunchGuardErrorCode;
  details?: Record<string, unknown>;
};

type FranceLaunchProfileInput = FranceLaunchLocationInput & {
  countryCode?: string | null;
};

// Approximation volontaire pour le lancement: polygone principal + sous-zones
// dédiées aux Alpes, à l'Alsace et à la Corse. Ce garde-fou n'est pas un moteur
// SIG légal; il sert uniquement à bloquer clairement les usages hors-France.
const MAINLAND_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [-5.2, 48.6],
  [-4.7, 47.5],
  [-2.8, 47.0],
  [-1.8, 43.2],
  [1.7, 42.4],
  [3.2, 42.4],
  [7.6, 43.3],
  [7.5, 44.2],
  [6.0, 45.3],
  [5.0, 46.3],
  [4.8, 47.4],
  [3.4, 50.95],
  [1.4, 50.9],
  [-0.8, 49.9],
  [-5.2, 48.6],
];

const ALPS_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [5.8, 45.4],
  [7.15, 45.4],
  [7.15, 46.05],
  [6.35, 46.05],
  [5.95, 46.2],
  [5.8, 45.8],
  [5.8, 45.4],
];

const ALSACE_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [6.8, 47.65],
  [7.8, 47.65],
  [7.8, 49.2],
  [6.8, 49.2],
  [6.8, 47.65],
];

const CORSICA_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [8.5, 41.3],
  [9.6, 41.3],
  [9.6, 43.1],
  [8.5, 43.1],
  [8.5, 41.3],
];

function createFranceLaunchGuardError(
  status: number,
  code: FranceLaunchGuardErrorCode,
  message: string,
  details?: Record<string, unknown>,
): FranceLaunchGuardError {
  return Object.assign(new Error(message), {
    status,
    code,
    ...(details !== undefined ? { details } : {}),
  });
}

function pointInPolygon(point: readonly [number, number], polygon: ReadonlyArray<readonly [number, number]>): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function hasCoordinatePair(input: FranceLaunchLocationInput): input is FranceLaunchLocationInput & CoordinatePair {
  return typeof input.lat === 'number' && typeof input.lng === 'number';
}

export function normalizeCountryCode(countryCode?: string | null): string | null {
  if (typeof countryCode !== 'string') return null;
  const normalized = countryCode.trim().toUpperCase();
  return normalized.length === 2 ? normalized : null;
}

export function isFranceLaunchCoordinate(lat: number, lng: number): boolean {
  const point: readonly [number, number] = [lng, lat];
  return [MAINLAND_POLYGON, ALPS_POLYGON, ALSACE_POLYGON, CORSICA_POLYGON].some((polygon) =>
    pointInPolygon(point, polygon),
  );
}

export function assertFranceLaunchLocation(location?: CoordinatePair | null): void {
  if (!location) return;
  if (!isFranceLaunchCoordinate(location.lat, location.lng)) {
    throw createFranceLaunchGuardError(403, ERROR_CODES.FRANCE_ONLY_RESTRICTED, FRANCE_ONLY_SCOPE_MESSAGE);
  }
}

export function assertFranceLaunchLocationPresence(hasLat: boolean, hasLng: boolean): void {
  if (hasLat !== hasLng) {
    throw createFranceLaunchGuardError(
      400,
      ERROR_CODES.FRANCE_ONLY_INCOMPLETE_LOCATION,
      'La latitude et la longitude doivent être fournies ensemble.',
    );
  }
}

export function assertFranceLaunchLocationInput(input: FranceLaunchLocationInput): void {
  assertFranceLaunchLocationPresence(input.lat != null, input.lng != null);

  if (hasCoordinatePair(input)) {
    assertFranceLaunchLocation({ lat: input.lat, lng: input.lng });
  }
}

export function assertFranceLaunchProProfile(input: FranceLaunchProfileInput): string {
  const normalizedCountryCode = normalizeCountryCode(input.countryCode);

  if (!normalizedCountryCode) {
    throw createFranceLaunchGuardError(
      400,
      ERROR_CODES.FRANCE_ONLY_COUNTRY_REQUIRED,
      'Le pays du compte professionnel doit être renseigné et fixé à FR.',
    );
  }

  if (normalizedCountryCode !== FRANCE_ONLY_COUNTRY_CODE) {
    throw createFranceLaunchGuardError(403, ERROR_CODES.FRANCE_ONLY_RESTRICTED, FRANCE_ONLY_SCOPE_MESSAGE, {
      actualCountryCode: normalizedCountryCode,
      expectedCountryCode: FRANCE_ONLY_COUNTRY_CODE,
    });
  }

  assertFranceLaunchLocationInput(input);

  return normalizedCountryCode;
}

export function isFranceLaunchGuardError(error: unknown): error is FranceLaunchGuardError {
  return (
    error instanceof Error &&
    typeof (error as Partial<FranceLaunchGuardError>).status === 'number' &&
    typeof (error as Partial<FranceLaunchGuardError>).code === 'string' &&
    String((error as Partial<FranceLaunchGuardError>).code).startsWith('FRANCE_ONLY_')
  );
}
