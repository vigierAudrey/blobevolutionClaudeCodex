/**
 * Pro public profile slug + publicCity validation.
 *
 * Slugs are the public identifier of /pros/[slug] pages. They are generated
 * server-side from the businessName at first publication and stay stable
 * afterwards (SEO + shared links must not break when the name changes).
 *
 * Security:
 * - Reserved words prevent collisions with app routes (/pros/new, /admin…).
 * - publicCity is the ONLY public location field (pro-declared); it is
 *   validated strictly so no address/PII/HTML can be smuggled into SEO pages.
 *
 * @module pro-slug
 */

import { randomBytes } from 'crypto';

/** Max slug length (base part, before any collision suffix). */
export const MAX_SLUG_LENGTH = 48;

/** Max attempts to find a free slug before giving up. */
const MAX_SLUG_ATTEMPTS = 5;

/** Collision suffix: 4 hex chars = 65k variants per base slug. */
const SUFFIX_BYTES = 2;

/**
 * Route segments and sensitive words a pro slug must never shadow.
 * Keep in sync with top-level app routes when adding public pages.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'aide',
  'account',
  'blob',
  'blobsurf',
  'blobosphere',
  'contact',
  'dashboard',
  'edit',
  'help',
  'index',
  'login',
  'matching',
  'me',
  'messages',
  'moderation',
  'new',
  'onboarding',
  'pro',
  'pros',
  'profile',
  'register',
  'search',
  'settings',
  'sitemap',
  'slugs',
  'support',
]);

/**
 * Turn a business name into a URL-safe slug base.
 * Accents are stripped (é→e), anything non [a-z0-9] becomes a hyphen,
 * hyphens are collapsed and trimmed. Returns null when nothing usable
 * remains (empty name, symbols only, reserved word).
 */
export function slugifyBusinessName(businessName: string): string | null {
  const base = businessName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  if (base.length < 2) return null;
  if (RESERVED_SLUGS.has(base)) return null;
  return base;
}

/** Random lowercase hex suffix used to resolve slug collisions. */
function randomSlugSuffix(): string {
  return randomBytes(SUFFIX_BYTES).toString('hex');
}

/**
 * Generate a unique slug for a pro.
 *
 * `isTaken` is provided by the caller (DB lookup) so this module stays
 * pure and unit-testable. First candidate is the plain base; collisions
 * get a short random suffix. Throws if the name yields no usable base
 * (caller must require a valid businessName before publication) or if
 * all attempts collide (statistically unreachable).
 */
export async function generateUniqueProSlug(
  businessName: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyBusinessName(businessName);
  if (!base) {
    throw new Error('SLUG_INVALID_BUSINESS_NAME');
  }

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix()}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error('SLUG_GENERATION_EXHAUSTED');
}

/** Bounds for a pro-declared public city name. */
export const PUBLIC_CITY_MIN_LENGTH = 2;
export const PUBLIC_CITY_MAX_LENGTH = 48;

/**
 * Letters (with accents), digits (e.g. "Vieux-Boucau-les-Bains 40"), spaces,
 * hyphens and apostrophes only — no punctuation that could carry markup,
 * URLs or addresses into public SEO pages.
 */
const PUBLIC_CITY_PATTERN = /^[\p{Letter}\p{Mark}0-9]+(?:[ '’-][\p{Letter}\p{Mark}0-9]+)*$/u;

/**
 * Validate and normalize a public city name.
 * Returns the trimmed, whitespace-collapsed city, or null when invalid.
 */
export function validatePublicCity(city: string): string | null {
  const normalized = city.trim().replace(/\s+/g, ' ');
  if (
    normalized.length < PUBLIC_CITY_MIN_LENGTH ||
    normalized.length > PUBLIC_CITY_MAX_LENGTH
  ) {
    return null;
  }
  if (!PUBLIC_CITY_PATTERN.test(normalized)) return null;
  return normalized;
}
