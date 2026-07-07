/**
 * Fetch d'un profil pro publiable (/pros/[slug]) côté serveur.
 *
 * Aucune auth : consomme GET /public/pros/:slug (allowlist stricte côté API,
 * cf. apps/api/src/modules/pro/pro.public.ts). Toute erreur réseau ou 404
 * renvoie null — la page appelante décide alors d'appeler notFound().
 */

export const SPORT_LABELS: Record<string, string> = { surf: 'Surf', kitesurf: 'Kitesurf' };

export const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
};

export type PublicProOffer = {
  sport: string;
  level: string;
  title: string;
  hourlyRate: number;
};

export type PublicProProfile = {
  slug: string;
  businessName: string;
  bio: string | null;
  photoUrl: string | null;
  publicCity: string | null;
  pricePerHour: number | null;
  verified: boolean;
  offers: PublicProOffer[];
};

function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
}

/**
 * Renvoie le profil publiable, ou null si absent/opt-out/supprimé/erreur réseau.
 *
 * cache: 'no-store' délibéré — publicEnabled est un contrôle d'accès RGPD
 * (opt-in/opt-out du pro). Un cache ici retarderait la prise d'effet d'une
 * désactivation au-delà de ce que "Désactiver ma page publique" promet à
 * l'utilisateur. Le Data Cache de Next.js persiste sur disque (.next/cache)
 * au-delà même d'un redémarrage du serveur — testé manuellement, un simple
 * revalidate ne suffisait pas à garantir l'immédiateté.
 */
export async function loadPublicProProfile(slug: string): Promise<PublicProProfile | null> {
  try {
    const res = await fetch(`${getApiUrl()}/public/pros/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.businessName !== 'string' || typeof data.slug !== 'string') {
      return null;
    }
    return data as PublicProProfile;
  } catch {
    return null;
  }
}

export type PublicProListItem = {
  slug: string;
  businessName: string;
  photoUrl: string | null;
  publicCity: string | null;
  verified: boolean;
};

export type PublicProListPage = { items: PublicProListItem[]; nextCursor: string | null };

/** Une page de l'annuaire public /pros. Fail-open : page vide si l'API échoue. */
export async function loadPublicProList(cursor?: string): Promise<PublicProListPage> {
  try {
    const url = new URL(`${getApiUrl()}/public/pros`);
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, { next: { revalidate: 120 } });
    if (!res.ok) return { items: [], nextCursor: null };
    const data = await res.json();
    if (!Array.isArray(data?.items)) return { items: [], nextCursor: null };
    return { items: data.items, nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null };
  } catch {
    return { items: [], nextCursor: null };
  }
}

export type PublicProSlugEntry = { slug: string; updatedAt: string };

/** Liste paginée des slugs publiés — alimente le sitemap. Fail-open : [] si l'API est indisponible. */
export async function loadPublicProSlugs(): Promise<PublicProSlugEntry[]> {
  const entries: PublicProSlugEntry[] = [];
  let cursor: string | null = null;

  try {
    for (let page = 0; page < 50; page++) {
      const url = new URL(`${getApiUrl()}/public/pros/slugs`);
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url, { next: { revalidate: 300 } });
      if (!res.ok) break;
      const data = await res.json();
      if (!Array.isArray(data?.items)) break;

      entries.push(...data.items);
      cursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
      if (!cursor) break;
    }
  } catch {
    // Fail-open : le sitemap sort quand même sans les fiches pros.
  }

  return entries;
}
