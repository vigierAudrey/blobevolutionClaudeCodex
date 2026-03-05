import type { MetadataRoute } from 'next';
import { loadBlobosphereSitemapEntries } from '@/lib/blobosphere/loadBlobosphereSitemapEntries';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://blobinfini.com').replace(/\/+$/, '');

function getBlobosphereArticleUrl(slug: string): string {
  return `${SITE_URL}/blobosphere/${encodeURIComponent(slug)}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await loadBlobosphereSitemapEntries();
  const blobosphereLastModified = articles[0]?.lastModified;

  return [
    {
      url: `${SITE_URL}/blobosphere`,
      lastModified: blobosphereLastModified,
    },
    ...articles.map((article) => ({
      url: getBlobosphereArticleUrl(article.slug),
      lastModified: article.lastModified,
    })),
  ];
}
