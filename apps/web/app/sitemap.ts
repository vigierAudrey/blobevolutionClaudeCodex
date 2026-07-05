import type { MetadataRoute } from 'next';
import { loadBlobosphereSitemapEntries } from '@/lib/blobosphere/loadBlobosphereSitemapEntries';
import { loadPublicProSlugs } from '@/lib/pros/loadPublicProProfile';

function normalizeSiteUrl(value: string): string {
  const parsed = new URL(value.trim());
  return `${parsed.protocol}//${parsed.host}`;
}

function getSiteUrl(): string {
  const fromEnv = process.env.SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) {
    return normalizeSiteUrl(fromEnv);
  }

  if (process.env.NODE_ENV === 'production') {
    return 'https://blobsurf.com';
  }

  return 'http://localhost:3000';
}

function getBlobosphereArticleUrl(siteUrl: string, slug: string): string {
  return `${siteUrl}/blobosphere/${encodeURIComponent(slug)}`;
}

function getProProfileUrl(siteUrl: string, slug: string): string {
  return `${siteUrl}/pros/${encodeURIComponent(slug)}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const articles = (await loadBlobosphereSitemapEntries()).sort((a, b) => {
    const timeDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.slug.localeCompare(b.slug);
  });
  const blobosphereLastModified = articles[0]?.lastModified;
  // Fail-open : une API indisponible renvoie [] (cf. loadPublicProSlugs), le
  // sitemap sort quand même avec la blobosphère seule.
  const proSlugs = await loadPublicProSlugs();

  return [
    {
      url: `${siteUrl}/blobosphere`,
      lastModified: blobosphereLastModified,
    },
    ...articles.map((article) => ({
      url: getBlobosphereArticleUrl(siteUrl, article.slug),
      lastModified: article.lastModified,
    })),
    ...proSlugs.map((entry) => ({
      url: getProProfileUrl(siteUrl, entry.slug),
      lastModified: entry.updatedAt,
    })),
  ];
}
