import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { listMdxFiles } from './fs';
import { BlobosphereCategory, BLOBOSPHERE_CATEGORIES, computeReadingTime, isPublicBlobosphereStatus } from './utils';

export type BlobosphereArticlePreview = {
  slug: string;
  title: string;
  excerpt: string;
  topic: BlobosphereCategory;
  readingTime: string;
  publishedAt: string;
  tags: string[];
};

function cleanExcerpt(excerpt: string): string {
  return excerpt.replace(/[#>*`]/g, '').replace(/\s+/g, ' ').trim();
}

export async function loadBlobospherePreviews(): Promise<BlobosphereArticlePreview[]> {
  let paths: string[] = [];
  try {
    paths = await listMdxFiles();
  } catch {
    return [];
  }

  const previews: BlobosphereArticlePreview[] = [];
  for (const filePath of paths) {
    const raw = await fs.readFile(filePath, 'utf8');
    const { data, content } = matter(raw);
    if (!isPublicBlobosphereStatus(data.status)) continue;

    const category = (typeof data.category === 'string' ? data.category.toLowerCase() : '') as BlobosphereCategory;
    if (!BLOBOSPHERE_CATEGORIES.includes(category)) continue;
    const slug =
      typeof data.slug === 'string'
        ? data.slug
        : path.basename(filePath).replace(/\.(mdx|md)$/i, '');
    const title = typeof data.title === 'string' ? data.title : slug;
    const excerptSrc =
      typeof data.excerpt === 'string' && data.excerpt.trim().length > 0
        ? data.excerpt
        : content.split(/\n\n/).find((paragraph) => paragraph.trim().length > 0) ?? '';
    const excerpt = cleanExcerpt(excerptSrc).slice(0, 220);
    const tags = Array.isArray(data.tags) ? data.tags.map((tag) => String(tag)) : [];
    const readingTimeValue =
      typeof data.readingTime === 'number' && data.readingTime > 0
        ? data.readingTime
        : computeReadingTime(content);
    const publishedAt =
      typeof data.publishedAt === 'string' && data.publishedAt.length > 0
        ? data.publishedAt
        : new Date().toISOString();

    previews.push({
      slug,
      title,
      excerpt,
      topic: category,
      readingTime: `${readingTimeValue} min`,
      publishedAt,
      tags,
    });
  }

  return previews.sort((a, b) => {
    const aTime = new Date(a.publishedAt).getTime();
    const bTime = new Date(b.publishedAt).getTime();
    return bTime - aTime;
  });
}
