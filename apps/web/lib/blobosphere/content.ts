import path from 'node:path';
import { promises as fs } from 'node:fs';

export type BlobosphereCategory = 'surf' | 'kitesurf' | 'communaute' | 'impact';

export type BlobosphereFrontmatter = {
  title: string;
  slug: string;
  category: BlobosphereCategory;
  tags: string[];
  excerpt: string;
  status: 'draft' | 'published';
  publishedAt: string;
  updatedAt: string | null;
  coverImage: string | null;
  readingTime: number | null;
  language: 'fr';
};

export type BlobosphereArticlePreview = {
  slug: string;
  title: string;
  excerpt: string;
  topic: BlobosphereCategory; // to stay compatible with page UI
  readingTime: string;
  publishedAt: string;
  tags: string[];
};

const CONTENT_ROOT = path.join(process.cwd(), 'apps', 'web', 'content', 'blobosphere');

function stripMdExt(filename: string) {
  return filename.replace(/\.mdx?$/i, '');
}

function minutesFromText(text: string): number {
  const words = (text || '').replace(/[`*_#>\-]/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function parseFrontmatter(raw: string): { data: Partial<BlobosphereFrontmatter>; body: string } {
  const start = raw.indexOf('---');
  if (start !== 0) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const yaml = raw.slice(3, end + 1).trim();
  const body = raw.slice(end + 4);

  // Minimal YAML parser for simple scalars and arrays
  const data: any = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1] as keyof BlobosphereFrontmatter;
    let value = m[2];
    if (value === '' || value === null) {
      // maybe a block list starts on next lines
      const arr: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        const li = l.match(/^\s*-\s*(.*)$/);
        if (li) { arr.push(li[1].trim()); j++; continue; }
        break;
      }
      if (arr.length) { data[key] = arr; i = j; continue; }
      data[key] = '';
      i++;
      continue;
    }
    // inline array: [a, b]
    if (/^\[.*\]$/.test(value)) {
      const items = value.replace(/^[\[\]]/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      data[key] = items;
    } else {
      let v: any = value.replace(/^"|"$/g, '').trim();
      if (v === 'null') v = null;
      if (v === 'true') v = true;
      if (v === 'false') v = false;
      if (/^\d+$/.test(v)) v = Number(v);
      data[key] = v;
    }
    i++;
  }

  return { data, body };
}

export async function loadBlobospherePreviews(): Promise<BlobosphereArticlePreview[]> {
  const categories: BlobosphereCategory[] = ['surf', 'kitesurf', 'communaute', 'impact'];
  const previews: BlobosphereArticlePreview[] = [];
  for (const cat of categories) {
    const dir = path.join(CONTENT_ROOT, cat);
    let files: string[] = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      const { data, body } = parseFrontmatter(raw);
      // Ne pas exposer les brouillons en liste publique
      const status = (data.status as string) || 'draft';
      if (status !== 'published') continue;
      const title = (data.title as string) || stripMdExt(file);
      const slug = (data.slug as string) || stripMdExt(file);
      const excerpt = (data.excerpt as string) || body.split(/\n\n/)[0]?.replace(/[#*>`]/g, '').slice(0, 220) || '';
      const tags = (Array.isArray(data.tags) ? data.tags : []) as string[];
      const publishedAt = (data.publishedAt as string) || new Date().toISOString().slice(0, 10);
      const rt = (typeof data.readingTime === 'number' ? data.readingTime : minutesFromText(body));
      previews.push({
        slug,
        title,
        excerpt,
        topic: cat,
        readingTime: `${rt} min`,
        publishedAt,
        tags,
      });
    }
  }
  // newest first
  return previews.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}
