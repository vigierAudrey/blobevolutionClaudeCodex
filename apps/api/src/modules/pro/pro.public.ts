/**
 * Routes publiques des profils pros — pages /pros/[slug] (SEO, partage).
 *
 * Contrat serveur :
 *   - Aucune auth : tout ce qui sort d'ici est publiable sur Internet.
 *   - Un profil n'est servi que si publicEnabled=true, slug défini,
 *     businessName renseigné et compte non supprimé — sinon 404 uniforme.
 *   - Le DTO ne contient JAMAIS : id, userId, lat, lng, email, emailNotif,
 *     notificationPreferences, countryCode, radiusKm, createdAt, updatedAt.
 *     publicCity (déclarée par le pro) est la seule localisation exposée.
 *   - Rate limit par IP canonique (jamais req.ip — cf. guardrail no-direct-ip).
 */
import { Router, type Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { clientPrisma as prisma } from '@blobinfini/database';
import { createLazyCustomRateLimiter } from '../../middleware/enhanced-rate-limit';
import { getClientIp } from '../../lib/client-ip';

export const proPublicRouter = Router();

const ipKey = (req: Request): string => {
  const ip = getClientIp(req) ?? req.socket?.remoteAddress;
  return ip ? ipKeyGenerator(ip) : 'anonymous';
};

// Lecture publique d'une fiche : 60/min/IP (navigation + crawlers légitimes).
const publicProfileLimiter = createLazyCustomRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Trop de requêtes. Veuillez réessayer dans une minute.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
}, 'pro_public_profile');

// Liste des slugs (sitemap) : endpoint d'énumération → fenêtre plus stricte.
const publicSlugsLimiter = createLazyCustomRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Trop de requêtes. Veuillez réessayer dans une minute.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
}, 'pro_public_slugs');

const SLUG_PATTERN = /^[a-z0-9-]{2,64}$/;

/** Filtre commun : seul un profil publié et complet d'un compte actif sort. */
const publishableWhere = (slug?: string) => ({
  ...(slug ? { slug } : { slug: { not: null } }),
  publicEnabled: true,
  businessName: { not: null },
  user: { deletedAt: null },
});

const SLUGS_PAGE_SIZE = 200;

// GET /public/pros/slugs — alimente le sitemap. Pagination par curseur (slug).
proPublicRouter.get('/slugs', publicSlugsLimiter, async (req, res) => {
  const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  if (rawCursor !== undefined && !SLUG_PATTERN.test(rawCursor)) {
    return res.status(400).json({ error: 'Invalid cursor' });
  }

  const rows = await prisma.proProfile.findMany({
    where: publishableWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: { slug: 'asc' },
    take: SLUGS_PAGE_SIZE + 1,
    ...(rawCursor ? { cursor: { slug: rawCursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > SLUGS_PAGE_SIZE;
  const items = (hasMore ? rows.slice(0, SLUGS_PAGE_SIZE) : rows).map(
    (row: { slug: string | null; updatedAt: Date }) => ({
      slug: row.slug,
      updatedAt: row.updatedAt.toISOString(),
    }),
  );

  res.set('Cache-Control', 'public, max-age=0, s-maxage=300');
  return res.json({
    items,
    nextCursor: hasMore ? items[items.length - 1]?.slug ?? null : null,
  });
});

// GET /public/pros/:slug — la fiche publique elle-même.
proPublicRouter.get('/:slug', publicProfileLimiter, async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const profile = await prisma.proProfile.findFirst({
    where: publishableWhere(slug),
    select: {
      slug: true,
      businessName: true,
      bio: true,
      photoUrl: true,
      publicCity: true,
      pricePerHour: true,
      verified: true,
      offers: {
        where: { isActive: true },
        select: { sport: true, level: true, title: true, hourlyRate: true },
        orderBy: [{ sport: 'asc' }, { level: 'asc' }],
      },
    },
  });

  if (!profile) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.set('Cache-Control', 'public, max-age=0, s-maxage=60');
  return res.json({
    slug: profile.slug,
    businessName: profile.businessName,
    bio: profile.bio,
    photoUrl: profile.photoUrl,
    publicCity: profile.publicCity,
    pricePerHour: profile.pricePerHour,
    verified: profile.verified,
    offers: profile.offers.map(
      (offer: { sport: string; level: string; title: string; hourlyRate: unknown }) => ({
        sport: offer.sport,
        level: offer.level,
        title: offer.title,
        hourlyRate: Number(offer.hourlyRate),
      }),
    ),
  });
});
