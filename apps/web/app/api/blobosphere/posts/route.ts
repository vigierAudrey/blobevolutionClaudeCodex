import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { listMdxFiles } from '@/lib/blobosphere/fs';
import { saveMdx, type SaveMdxPayload } from '@/lib/blobosphere/saveMdx';
import { BLOBOSPHERE_CONTENT_ROOT, BlobosphereCategory, ensureCategory, sanitizeSlug } from '@/lib/blobosphere/utils';

export const runtime = 'nodejs';

function isDevRequest() {
  return process.env.NODE_ENV === 'development';
}

function devOnlyResponse() {
  return NextResponse.json({ error: 'Blobosphère CMS accessible uniquement en local.' }, { status: 403 });
}

type ListItem = {
  category: BlobosphereCategory;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
  path: string;
};

export async function GET() {
  let files: string[] = [];
  try {
    files = await listMdxFiles();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json({ items: [] });
    }
    const message = err instanceof Error ? err.message : 'Impossible de lire le contenu Blobosphère';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const items: ListItem[] = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const { data } = matter(raw);
    const category = (typeof data.category === 'string'
      ? data.category.toLowerCase()
      : path.relative(BLOBOSPHERE_CONTENT_ROOT, filePath).split(path.sep)[0]) as BlobosphereCategory;
    if (!category || !['surf', 'kitesurf', 'communaute', 'impact'].includes(category)) {
      continue;
    }
    const slug =
      typeof data.slug === 'string'
        ? data.slug
        : path.basename(filePath).replace(/\.(mdx|md)$/i, '');
    items.push({
      category,
      slug,
      title: typeof data.title === 'string' ? data.title : slug,
      status: typeof data.status === 'string' ? data.status : 'draft',
      publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : null,
      path: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
    });
  }

  return NextResponse.json({ items });
}

function parsePayload(data: unknown): SaveMdxPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Payload invalide');
  }
  const payload = data as Record<string, unknown>;
  const title = typeof payload.title === 'string' && payload.title.trim().length > 0 ? payload.title.trim() : null;
  const slugValue = typeof payload.slug === 'string' && payload.slug.trim().length > 0 ? payload.slug : title;
  const categoryValue = typeof payload.category === 'string' ? payload.category : '';
  if (!title || !slugValue) {
    throw new Error('Titre et slug requis');
  }
  const category = ensureCategory(categoryValue);
  const tags: string[] = Array.isArray(payload.tags)
    ? payload.tags.map((tag: unknown) => String(tag))
    : typeof payload.tags === 'string'
      ? payload.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean)
      : [];

  return {
    title,
    slug: sanitizeSlug(slugValue),
    category,
    excerpt: typeof payload.excerpt === 'string' ? payload.excerpt : '',
    tags,
    status: payload.status === 'published' ? 'published' : 'draft',
    publishedAt: typeof payload.publishedAt === 'string' ? payload.publishedAt : undefined,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
    coverImage: typeof payload.coverImage === 'string' ? payload.coverImage : '',
    readingTime: typeof payload.readingTime === 'number' ? payload.readingTime : null,
    body: typeof payload.body === 'string' ? payload.body : '',
  };
}

export async function POST(req: NextRequest) {
  if (!isDevRequest()) {
    return devOnlyResponse();
  }

  try {
    const payload = parsePayload(await req.json());
    const filePath = await saveMdx(payload, { overwrite: false });
    return NextResponse.json({
      success: true,
      path: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
    const status = message.includes('existe déjà') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
