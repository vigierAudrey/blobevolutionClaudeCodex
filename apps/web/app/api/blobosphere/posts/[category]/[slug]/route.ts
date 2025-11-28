import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { buildUpdatePayload } from '@/lib/blobosphere/payload';
import { saveMdx, type SaveMdxPayload } from '@/lib/blobosphere/saveMdx';
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

    const defaultPayload: SaveMdxPayload = {
      title: typeof data.title === 'string' ? data.title : params.slug,
      slug: typeof data.slug === 'string' ? sanitizeSlug(data.slug) : params.slug,
      category: ensureCategory(typeof data.category === 'string' ? data.category : params.category),
      excerpt: typeof data.excerpt === 'string' ? data.excerpt : '',
      tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag)) : [],
      status: data.status === 'published' ? 'published' : 'draft',
      publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : undefined,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
      coverImage: typeof data.coverImage === 'string' ? data.coverImage : '',
      readingTime: typeof data.readingTime === 'number' ? data.readingTime : null,
      body: content,
    };

    const overrides = buildUpdatePayload(await req.json());
    const targetCategory = overrides.newCategory ?? overrides.category ?? defaultPayload.category;
    const targetSlug = sanitizeSlug(overrides.newSlug ?? overrides.slug ?? defaultPayload.slug);
    const tags = overrides.tags && overrides.tags.length > 0 ? overrides.tags : defaultPayload.tags;
    const payload: SaveMdxPayload = {
      ...defaultPayload,
      title: overrides.title ? overrides.title.trim() : defaultPayload.title,
      slug: targetSlug,
      category: targetCategory,
      excerpt: overrides.excerpt ?? defaultPayload.excerpt,
      tags,
      status: overrides.status ?? defaultPayload.status,
      publishedAt: overrides.publishedAt ?? defaultPayload.publishedAt,
      updatedAt: overrides.updatedAt ?? new Date().toISOString(),
      coverImage: overrides.coverImage ?? defaultPayload.coverImage,
      readingTime: overrides.readingTime ?? defaultPayload.readingTime,
      body: overrides.body ?? defaultPayload.body,
    };

    const newPath = await saveMdx(payload, { overwrite: true });
    const normalizedCurrent = path.relative(process.cwd(), currentPath).replace(/\\/g, '/');
    const normalizedNew = path.relative(process.cwd(), newPath).replace(/\\/g, '/');
    if (normalizedCurrent !== normalizedNew) {
      await fs.rm(currentPath, { force: true });
    }

    return NextResponse.json({ success: true, item: payload, path: normalizedNew, previousPath: normalizedCurrent });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Article introuvable' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { category: string; slug: string } },
) {
  if (!isDevRequest()) {
    return devOnlyResponse();
  }
  try {
    const filePath = await resolveFile(params.category, params.slug);
    await fs.rm(filePath);
    return NextResponse.json({
      success: true,
      path: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
    });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Article introuvable' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
