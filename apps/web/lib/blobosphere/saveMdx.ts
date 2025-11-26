import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BLOBOSPHERE_CONTENT_ROOT, BlobosphereCategory, computeReadingTime, ensureCategory, ensureDateString, sanitizeSlug } from './utils';

export type SaveMdxPayload = {
  title: string;
  slug: string;
  category: BlobosphereCategory | string;
  excerpt?: string;
  tags?: string[];
  status?: 'draft' | 'published';
  publishedAt?: string;
  updatedAt?: string;
  coverImage?: string | null;
  readingTime?: number | null;
  body?: string;
};

type SaveMdxOptions = {
  overwrite?: boolean;
};

export async function saveMdx(payload: SaveMdxPayload, options: SaveMdxOptions = {}): Promise<string> {
  const slug = sanitizeSlug(payload.slug || payload.title);
  if (!slug) {
    throw new Error('Slug invalide');
  }

  const category = ensureCategory(payload.category);
  const dir = path.join(BLOBOSPHERE_CONTENT_ROOT, category);
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${slug}.mdx`);
  if (!options.overwrite) {
    try {
      await fs.access(filePath);
      throw new Error(`Le fichier ${filePath} existe déjà`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  const now = new Date().toISOString();
  const publishedAt = ensureDateString(payload.publishedAt || now);
  const updatedAt = ensureDateString(payload.updatedAt || now);
  const readingTime = (payload.readingTime ?? computeReadingTime(payload.body || ''));
  const tags = Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : [];
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(payload.title)}`,
    `slug: ${JSON.stringify(slug)}`,
    `category: ${JSON.stringify(category)}`,
    `excerpt: ${JSON.stringify(payload.excerpt ?? '')}`,
    `tags: ${JSON.stringify(tags)}`,
    `status: ${JSON.stringify(payload.status ?? 'draft')}`,
    `publishedAt: ${JSON.stringify(publishedAt)}`,
    `updatedAt: ${JSON.stringify(updatedAt)}`,
    `coverImage: ${JSON.stringify(payload.coverImage ?? '')}`,
    `readingTime: ${readingTime}`,
    '---',
  ].join('\n');

  const body = (payload.body ?? '').trimEnd();
  const content = body.length > 0 ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`;
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}
