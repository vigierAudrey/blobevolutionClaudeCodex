import path from 'node:path';
import fs from 'node:fs/promises';

function resolveContentRoot() {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'api' && path.basename(path.dirname(cwd)) === 'apps') {
    return path.join(path.dirname(cwd), 'web', 'content', 'blobosphere');
  }
  return path.join(cwd, 'apps', 'web', 'content', 'blobosphere');
}

const CONTENT_ROOT = resolveContentRoot();
const CATEGORIES = ['surf', 'kitesurf', 'communaute', 'impact'] as const;

export type BlobosphereArticle = {
  title: string;
  slug: string;
  excerpt: string;
  publishedAt: string;
  cover: string | null;
  category: string;
  wordCount: number;
};

type ParsedArticle = BlobosphereArticle & {
  status: string;
  body: string;
};

const cleanExcerpt = (value: string) => value.replace(/[#>*`]/g, '').replace(/\s+/g, ' ').trim();

const parseFrontmatter = (raw: string) => {
  const start = raw.indexOf('---');
  const end = raw.indexOf('\n---', 3);
  const fm = start === 0 && end > 0 ? raw.slice(3, end + 1) : '';
  const body = end > 0 ? raw.slice(end + 4) : raw;
  const meta: Record<string, string> = {};
  if (fm) {
    for (const line of fm.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      const value = match[2].replace(/^"|"$/g, '');
      meta[key] = value;
    }
  }
  return { meta, body };
};

const countWords = (body: string) => {
  const cleaned = body.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
};

const toArticle = (category: string, file: string, raw: string): ParsedArticle | null => {
  const { meta, body } = parseFrontmatter(raw);
  const status = meta.status || 'draft';
  if (status !== 'published') return null;

  const slug = meta.slug || file.replace(/\.(mdx|md)$/i, '');
  const title = meta.title || slug;
  const excerptSrc = meta.excerpt && meta.excerpt.trim().length > 0
    ? meta.excerpt
    : body.split(/\n\n/).find((paragraph) => paragraph.trim().length > 0) ?? '';
  const excerpt = cleanExcerpt(excerptSrc).slice(0, 220);
  const publishedAt = meta.publishedAt || new Date().toISOString();
  const cover = meta.coverImage || null;
  const wordCount = countWords(body);

  return {
    title,
    slug,
    excerpt,
    publishedAt,
    cover,
    category,
    wordCount,
    status,
    body,
  };
};

export const loadPublishedBlobosphereArticles = async (): Promise<BlobosphereArticle[]> => {
  const items: BlobosphereArticle[] = [];
  for (const cat of CATEGORIES) {
    const dir = path.join(CONTENT_ROOT, cat);
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      const article = toArticle(cat, file, raw);
      if (!article) continue;
      items.push(article);
    }
  }
  return items;
};
