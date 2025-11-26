import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { saveMdx } from '@/lib/blobosphere/saveMdx';
import { BLOBOSPHERE_CONTENT_ROOT, ensureCategory, sanitizeSlug } from '@/lib/blobosphere/utils';

export const runtime = 'nodejs';

function isDevRequest() {
  return process.env.NODE_ENV === 'development';
}

function devOnlyResponse() {
  return NextResponse.json({ error: 'Blobosphère CMS accessible uniquement en local.' }, { status: 403 });
}

async function resolveFile(category: string, slug: string): Promise<string> {
  const safeCategory = ensureCategory(category);
  const safeSlug = sanitizeSlug(slug);
  return path.join(BLOBOSPHERE_CONTENT_ROOT, safeCategory, `${safeSlug}.mdx`);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { category: string; slug: string } },
) {
  try {
    const filePath = await resolveFile(params.category, params.slug);
    const raw = await fs.readFile(filePath, 'utf8');
    return NextResponse.json({ raw });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Article introuvable' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Erreur lecture fichier';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { category: string; slug: string } },
) {
  if (!isDevRequest()) {
    return devOnlyResponse();
  }
  try {
    const currentPath = await resolveFile(params.category, params.slug);
    const raw = await fs.readFile(currentPath, 'utf8');
    const { data, content } = matter(raw);

    const body = await req.json();
    const nextCategory = ensureCategory(
      typeof body.newCategory === 'string' ? body.newCategory : (data.category as string) || params.category,
    );
    const nextSlug = sanitizeSlug(
      typeof body.newSlug === 'string' && body.newSlug.length > 0 ? body.newSlug : (body.slug as string) || (data.slug as string) || params.slug,
    );
    const tags: string[] = Array.isArray(body.tags)
      ? body.tags.map((tag: unknown) => String(tag))
      : typeof body.tags === 'string'
        ? body.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean)
        : Array.isArray(data.tags)
          ? data.tags.map((tag: unknown) => String(tag))
          : [];

    const payload = {
      title: typeof body.title === 'string' ? body.title : (typeof data.title === 'string' ? data.title : nextSlug),
      slug: nextSlug,
      category: nextCategory,
      excerpt: typeof body.excerpt === 'string' ? body.excerpt : (typeof data.excerpt === 'string' ? data.excerpt : ''),
      tags,
      status:
        body.status === 'published'
          ? 'published'
          : typeof data.status === 'string'
            ? (data.status as 'draft' | 'published')
            : 'draft',
      publishedAt: typeof body.publishedAt === 'string' ? body.publishedAt : (data.publishedAt as string) || undefined,
      updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString(),
      coverImage: typeof body.coverImage === 'string' ? body.coverImage : (typeof data.coverImage === 'string' ? data.coverImage : ''),
      readingTime:
        typeof body.readingTime === 'number'
          ? body.readingTime
          : typeof data.readingTime === 'number'
            ? data.readingTime
            : null,
      body: typeof body.body === 'string' ? body.body : content,
    };

    const newPath = await saveMdx(payload, { overwrite: true });
    const normalizedCurrent = path.relative(process.cwd(), currentPath).replace(/\\/g, '/');
    const normalizedNew = path.relative(process.cwd(), newPath).replace(/\\/g, '/');
    if (normalizedCurrent !== normalizedNew) {
      await fs.rm(currentPath, { force: true });
    }

    return NextResponse.json({ success: true, path: normalizedNew });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Article introuvable' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
