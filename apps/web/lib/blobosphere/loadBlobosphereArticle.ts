import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { listMdxFiles } from './fs';
import {
  BLOBOSPHERE_CATEGORIES,
  computeReadingTime,
  isPublicBlobosphereStatus,
  sanitizeSlug,
  type BlobosphereCategory,
} from './utils';

export type PublicBlobosphereArticle = {
  slug: string;
  title: string;
  excerpt: string;
  category: BlobosphereCategory;
  publishedAt: string;
  updatedAt: string | null;
  readingTime: string;
  tags: string[];
  coverImage: string | null;
  body: string;
};

function cleanExcerpt(excerpt: string): string {
  return excerpt.replace(/[#>*`]/g, '').replace(/\s+/g, ' ').trim();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((tag) => String(tag).trim()).filter(Boolean);
}

export async function loadPublishedBlobosphereArticleBySlug(slugInput: string): Promise<PublicBlobosphereArticle | null> {
  const requestedSlug = sanitizeSlug(slugInput);
  if (!requestedSlug) {
    return null;
  }

  let paths: string[] = [];
  try {
    paths = await listMdxFiles();
  } catch {
    return null;
  }

  for (const filePath of paths) {
    const raw = await fs.readFile(filePath, 'utf8');
    const { data, content } = matter(raw);
    const slug = sanitizeSlug(readString(data.slug) ?? path.basename(filePath).replace(/\.(mdx|md)$/i, ''));
    if (slug !== requestedSlug) {
      continue;
    }

    if (!isPublicBlobosphereStatus(data.status)) {
      return null;
    }

    const category = (readString(data.category)?.toLowerCase() ?? '') as BlobosphereCategory;
    if (!BLOBOSPHERE_CATEGORIES.includes(category)) {
      return null;
    }

    const title = readString(data.title) ?? slug;
    const excerptSource = readString(data.excerpt) ?? content.split(/\n\n/).find((paragraph) => paragraph.trim().length > 0) ?? '';
    const publishedAt = readString(data.publishedAt) ?? new Date().toISOString();
    const updatedAt = readString(data.updatedAt);
    const readingTimeValue =
      typeof data.readingTime === 'number' && data.readingTime > 0
        ? data.readingTime
        : computeReadingTime(content);

    return {
      slug,
      title,
      excerpt: cleanExcerpt(excerptSource).slice(0, 220),
      category,
      publishedAt,
      updatedAt,
      readingTime: `${readingTimeValue} min`,
      tags: readTags(data.tags),
      coverImage: readString(data.coverImage),
      body: content,
    };
  }

  return null;
}

