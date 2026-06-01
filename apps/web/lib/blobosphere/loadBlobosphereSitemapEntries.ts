import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { listMdxFiles } from './fs';
import { BLOBOSPHERE_CATEGORIES, isPublicBlobosphereStatus, type BlobosphereCategory, sanitizeSlug } from './utils';

export type BlobosphereSitemapEntry = {
  slug: string;
  publishedAt: string;
  lastModified: string;
};

function isBlobospherePostPublic(frontmatter: Record<string, unknown>, now: Date): boolean {
  if (!isPublicBlobosphereStatus(frontmatter.status)) return false;

  const publishedAtValue = typeof frontmatter.publishedAt === 'string' ? frontmatter.publishedAt.trim() : '';
  if (!publishedAtValue) return false;

  const publishedAt = new Date(publishedAtValue);
  if (Number.isNaN(publishedAt.getTime())) return false;

  return publishedAt.getTime() <= now.getTime();
}

export async function loadBlobosphereSitemapEntries(now: Date = new Date()): Promise<BlobosphereSitemapEntry[]> {
  let paths: string[] = [];
  try {
    paths = await listMdxFiles();
  } catch {
    return [];
  }

  const entries: BlobosphereSitemapEntry[] = [];

  for (const filePath of paths) {
    const raw = await fs.readFile(filePath, 'utf8');
    const { data } = matter(raw);

    const category = (typeof data.category === 'string' ? data.category.toLowerCase() : '') as BlobosphereCategory;
    if (!BLOBOSPHERE_CATEGORIES.includes(category)) continue;
    if (!isBlobospherePostPublic(data, now)) continue;

    const rawSlug =
      typeof data.slug === 'string'
        ? data.slug
        : path.basename(filePath).replace(/\.(mdx|md)$/i, '');
    const slug = sanitizeSlug(rawSlug);
    if (!slug) continue;

    const publishedAt = typeof data.publishedAt === 'string' ? data.publishedAt.trim() : '';
    if (!publishedAt) continue;

    const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt.trim() : '';
    const hasValidUpdatedAt = updatedAt.length > 0 && !Number.isNaN(new Date(updatedAt).getTime());

    entries.push({
      slug,
      publishedAt,
      lastModified: hasValidUpdatedAt ? updatedAt : publishedAt,
    });
  }

  return entries.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}
