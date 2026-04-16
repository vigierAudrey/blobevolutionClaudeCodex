type Coordinate = {
  lat: number;
  lng: number;
};

type CountryCodeInput = string | null | undefined;

export type FranceOnlyError = Error & {
  code: 'FRANCE_ONLY';
  status: 403;
};

export const FRANCE_ONLY_MESSAGES = {
  feature: 'Cette fonctionnalité est actuellement disponible uniquement en France.',
  proRegistration: 'Pour le lancement, les profils professionnels sont disponibles uniquement en France.',
  proProfile: 'Le profil professionnel doit être localisé en France.',
  matchingSearch: 'La recherche géographique est actuellement limitée à la France.',
} as const;

const FRANCE_MAINLAND_BOUNDS = {
  minLat: 41.25,
  maxLat: 51.2,
  minLng: -5.4,
  maxLng: 8.4,
} as const;

const CORSICA_BOUNDS = {
  minLat: 41.2,
  maxLat: 43.2,
  minLng: 8.45,
  maxLng: 9.65,
} as const;

// Coarse mainland polygon alone slightly over-includes Geneva because the border is
// highly irregular there. A tiny exclusion box removes the Swiss city center without
// impacting the nearby French side (Annemasse / Pays de Gex).
const GENEVA_EXCLUSION_BOUNDS = {
  minLat: 46.14,
  maxLat: 46.24,
  minLng: 6.1,
  maxLng: 6.19,
} as const;

const FRANCE_MAINLAND_POLYGON: readonly Coordinate[] = [
  { lat: 48.683, lng: -4.795 },
  { lat: 47.977, lng: -4.842 },
  { lat: 47.206, lng: -4.729 },
  { lat: 46.226, lng: -1.865 },
  { lat: 43.373, lng: -1.791 },
  { lat: 42.592, lng: 0.647 },
  { lat: 42.485, lng: 2.648 },
  { lat: 43.075, lng: 3.126 },
  { lat: 43.303, lng: 4.768 },
  { lat: 43.640, lng: 7.554 },
  { lat: 44.255, lng: 7.145 },
  { lat: 45.064, lng: 6.728 },
  { lat: 45.923, lng: 6.792 },
  { lat: 46.286, lng: 6.118 },
  { lat: 47.588, lng: 7.588 },
  { lat: 49.542, lng: 7.593 },
  { lat: 50.274, lng: 4.274 },
  { lat: 50.965, lng: 2.546 },
  { lat: 49.724, lng: -1.943 },
  { lat: 48.683, lng: -4.795 },
] as const;

const CORSICA_POLYGON: readonly Coordinate[] = [
  { lat: 41.347, lng: 8.540 },
  { lat: 41.924, lng: 9.407 },
  { lat: 42.974, lng: 9.560 },
  { lat: 43.034, lng: 8.573 },
  { lat: 41.347, lng: 8.540 },
] as const;

type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isWithinBounds = (lat: number, lng: number, bounds: Bounds): boolean =>
  lat >= bounds.minLat &&
  lat <= bounds.maxLat &&
  lng >= bounds.minLng &&
  lng <= bounds.maxLng;

const pointInPolygon = (point: Coordinate, polygon: readonly Coordinate[]): boolean => {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]?.lng ?? 0;
    const yi = polygon[i]?.lat ?? 0;
    const xj = polygon[j]?.lng ?? 0;
    const yj = polygon[j]?.lat ?? 0;

    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
};

const createFranceOnlyError = (message: string): FranceOnlyError =>
  Object.assign(new Error(message), {
    code: 'FRANCE_ONLY' as const,
    status: 403 as const,
  });

export const normalizeCountryCode = (countryCode: CountryCodeInput): string | null => {
  if (typeof countryCode !== 'string') return null;
  const normalized = countryCode.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
};

export const isFranceCoordinatePair = (lat: number, lng: number): boolean => {
  if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lng)) return false;

  const point = { lat, lng };

  if (isWithinBounds(lat, lng, CORSICA_BOUNDS) && pointInPolygon(point, CORSICA_POLYGON)) {
    return true;
  }

  if (!isWithinBounds(lat, lng, FRANCE_MAINLAND_BOUNDS)) {
    return false;
  }

  if (isWithinBounds(lat, lng, GENEVA_EXCLUSION_BOUNDS)) {
    return false;
  }

  return pointInPolygon(point, FRANCE_MAINLAND_POLYGON);
};

export const isFranceCoordinates = (location: { lat: number; lng: number }): boolean =>
  isFranceCoordinatePair(location.lat, location.lng);

export const assertFranceCoordinates = (
  location: { lat: number; lng: number },
  message: string,
): void => {
  if (!isFranceCoordinates(location)) {
    throw createFranceOnlyError(message);
  }
};

export const assertFranceOnlyProLocation = (input: {
  countryCode?: CountryCodeInput;
  lat?: number | null;
  lng?: number | null;
}, message: string): void => {
  if (normalizeCountryCode(input.countryCode) !== 'FR') {
    throw createFranceOnlyError(message);
  }

  const hasLat = input.lat !== null && input.lat !== undefined;
  const hasLng = input.lng !== null && input.lng !== undefined;

  if (hasLat !== hasLng) {
    throw createFranceOnlyError(message);
  }

  if (hasLat && hasLng && !isFranceCoordinatePair(input.lat as number, input.lng as number)) {
    throw createFranceOnlyError(message);
  }
};

export const isFranceOnlyError = (error: unknown): error is FranceOnlyError =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      'status' in error &&
      (error as { code?: unknown }).code === 'FRANCE_ONLY' &&
      (error as { status?: unknown }).status === 403,
  );
