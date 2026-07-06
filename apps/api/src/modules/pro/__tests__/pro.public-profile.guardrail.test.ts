/**
 * Guardrail — public pro profile endpoints must never select banned fields.
 *
 * This is a static source scan (no DB, no HTTP) — a second, cheaper line of
 * defence alongside the e2e response contract in pro.public-profile.e2e.test.ts.
 * If someone later widens a Prisma `select` in pro.public.ts to add a field
 * back in (copy-paste from the owner controller, "just one more field"...),
 * this test fails at the source level even before an e2e test would catch it.
 *
 * HOW TO LEGITIMATELY ADD A FIELD: if a new field is genuinely safe to expose
 * publicly, add it to ALLOWED_SELECT_FIELDS below with a one-line reason —
 * do not just delete/weaken this test.
 */
import * as fs from 'fs';
import * as path from 'path';

const PRO_PUBLIC_SOURCE_PATH = path.join(__dirname, '../pro.public.ts');

// Fields that must never appear in the *profile* endpoint's Prisma
// `select: { field: true }` — internal metadata, exact geolocation, PII, or
// notification plumbing that belongs to the owner-only DTO
// (apps/api/src/modules/pro/pro.controller.ts), never to the unauthenticated
// public endpoint. NOTE: `updatedAt` is legitimately selected on the sibling
// /slugs endpoint (sitemap lastModified) — this list applies to the profile
// select only, see extractProfileSelectSection() below.
const BANNED_SELECT_FIELDS = [
  'id',
  'userId',
  'lat',
  'lng',
  'email',
  'emailNotif',
  'notificationPreferences',
  'countryCode',
  'radiusKm',
  'createdAt',
  'updatedAt',
  'description',
] as const;

/** Extracts the `prisma.proProfile.findFirst({ ... select: {...} ... })` block. */
function extractProfileSelectSection(source: string): string {
  const marker = 'proProfile.findFirst(';
  const idx = source.indexOf(marker);
  expect(idx).not.toBe(-1);
  return source.slice(idx, idx + 800);
}

function findBannedSelectFields(source: string): string[] {
  const found: string[] = [];
  for (const field of BANNED_SELECT_FIELDS) {
    const pattern = new RegExp(`\\b${field}\\s*:\\s*true\\b`);
    if (pattern.test(source)) {
      found.push(field);
    }
  }
  return found;
}

describe('Guardrail — public pro profile source never selects banned fields', () => {
  let source: string;

  beforeAll(() => {
    expect(fs.existsSync(PRO_PUBLIC_SOURCE_PATH)).toBe(true);
    source = fs.readFileSync(PRO_PUBLIC_SOURCE_PATH, 'utf8');
  });

  it('the profile select (GET /public/pros/:slug) contains no banned field', () => {
    const profileSection = extractProfileSelectSection(source);
    const found = findBannedSelectFields(profileSection);
    expect(found).toEqual(
      [],
      `Found banned field(s) selected for the public profile endpoint: ${found.join(', ')}. ` +
        'These must never reach the unauthenticated /public/pros/:slug response.',
    );
  });

  it('the /slugs select exposes only slug + updatedAt (sitemap lastModified)', () => {
    const routeIdx = source.indexOf("get('/slugs',");
    expect(routeIdx).not.toBe(-1);
    const slugsSection = source.slice(routeIdx, routeIdx + 500);
    expect(slugsSection).toContain('slug: true');
    expect(slugsSection).toContain('updatedAt: true');
    for (const banned of BANNED_SELECT_FIELDS.filter((f) => f !== 'updatedAt')) {
      expect(slugsSection).not.toMatch(new RegExp(`\\b${banned}\\s*:\\s*true\\b`));
    }
  });

  it("the directory select (GET /public/pros) contains no banned field", () => {
    const routeIdx = source.indexOf("get('/',");
    expect(routeIdx).not.toBe(-1);
    const directorySection = source.slice(routeIdx, routeIdx + 500);
    for (const field of ['slug', 'businessName', 'photoUrl', 'publicCity', 'verified']) {
      expect(directorySection).toContain(`${field}: true`);
    }
    for (const banned of BANNED_SELECT_FIELDS) {
      expect(directorySection).not.toMatch(new RegExp(`\\b${banned}\\s*:\\s*true\\b`));
    }
  });

  it('pro.public.ts selects only the documented public-safe offer fields', () => {
    const offersSelectIdx = source.indexOf('offers: {');
    expect(offersSelectIdx).not.toBe(-1);
    const offersSection = source.slice(offersSelectIdx, offersSelectIdx + 400);

    for (const field of ['sport', 'level', 'title', 'hourlyRate']) {
      expect(offersSection).toContain(`${field}: true`);
    }
    for (const banned of BANNED_SELECT_FIELDS) {
      expect(offersSection).not.toMatch(new RegExp(`\\b${banned}\\s*:\\s*true\\b`));
    }
  });
});

describe('Guardrail bypass coverage — detector catches a reintroduced banned field', () => {
  const BYPASS_CASES: Array<{ name: string; snippet: string }> = [
    { name: 'lat re-added to profile select', snippet: 'select: { businessName: true, lat: true }' },
    { name: 'lng re-added to profile select', snippet: 'select: { businessName: true, lng: true }' },
    { name: 'userId re-added', snippet: 'select: { slug: true, userId: true }' },
    { name: 'notificationPreferences re-added', snippet: 'select: { notificationPreferences: true }' },
    { name: 'offer description re-added', snippet: 'offers: { select: { title: true, description: true } }' },
  ];

  it.each(BYPASS_CASES)('detects: $name', ({ snippet }) => {
    expect(findBannedSelectFields(snippet).length).toBeGreaterThan(0);
  });

  it('does not false-positive on the legitimate current source', () => {
    const legitimateSnippet = 'select: { businessName: true, bio: true, photoUrl: true, publicCity: true, pricePerHour: true, verified: true, slug: true }';
    expect(findBannedSelectFields(legitimateSnippet)).toEqual([]);
  });
});
