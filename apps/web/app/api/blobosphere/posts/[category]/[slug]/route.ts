import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { buildUpdatePayload, type ParsedUpdatePayload } from '@/lib/blobosphere/payload';
import { saveMdx, type SaveMdxPayload } from '@/lib/blobosphere/saveMdx';
import { BLOBOSPHERE_CONTENT_ROOT, ensureCategory, normalizeBlobosphereStatus, sanitizeSlug } from '@/lib/blobosphere/utils';

export const runtime = 'nodejs';

function isDevRequest() {
  return process.env.NODE_ENV === 'development';
}

function devOnlyResponse() {
  return NextResponse.json({ error: 'Blobosphère CMS accessible uniquement en local.' }, { status: 403 });
}

function hasAdminSession(req: NextRequest) {
  return req.cookies.get('admin_session')?.value === '1';
}

function adminOnlyResponse() {
  return NextResponse.json({ error: 'Session admin requise.' }, { status: 401 });
}

function guardLocalCms(req: NextRequest) {
  if (!isDevRequest()) {
    return devOnlyResponse();
  }
  if (!hasAdminSession(req)) {
    return adminOnlyResponse();
  }
  return null;
}

async function resolveFile(category: string, slug: string): Promise<string> {
  const safeCategory = ensureCategory(category);
  const safeSlug = sanitizeSlug(slug);
  return path.join(BLOBOSPHERE_CONTENT_ROOT, safeCategory, `${safeSlug}.mdx`);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ category: string; slug: string }> },
) {
  const { category, slug } = await params;
  const blocked = guardLocalCms(_req);
  if (blocked) return blocked;

  try {
    const filePath = await resolveFile(category, slug);
    const raw = await fs.readFile(filePath, 'utf8');
    return NextResponse.json({ raw });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Article introuvable' }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : 'Erreur lecture fichier';
    console.error('[blobosphere] GET failed', { category, slug, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ category: string; slug: string }> },
) {
  const { category, slug } = await params;
  const blocked = guardLocalCms(req);
  if (blocked) return blocked;
  try {
    const currentPath = await resolveFile(category, slug);
    const raw = await fs.readFile(currentPath, 'utf8');
    const { data, content } = matter(raw);

    const defaultPayload: SaveMdxPayload = {
      title: typeof data.title === 'string' ? data.title : slug,
      slug: typeof data.slug === 'string' ? sanitizeSlug(data.slug) : slug,
      category: ensureCategory(typeof data.category === 'string' ? data.category : category),
      excerpt: typeof data.excerpt === 'string' ? data.excerpt : '',
      tags: Array.isArray(data.tags) ? data.tags.map((tag) => String(tag)) : [],
      status: normalizeBlobosphereStatus(data.status),
      publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : undefined,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
      coverImage: typeof data.coverImage === 'string' ? data.coverImage : '',
      readingTime: typeof data.readingTime === 'number' ? data.readingTime : null,
      body: content,
    };

    const overrides: ParsedUpdatePayload = buildUpdatePayload(await req.json());
    const targetCategory = overrides.newCategory ?? overrides.category ?? defaultPayload.category;
    const targetSlug = sanitizeSlug(overrides.newSlug ?? overrides.slug ?? defaultPayload.slug);
    const tags = overrides.tags && overrides.tags.length > 0 ? overrides.tags : defaultPayload.tags;

    const payload: SaveMdxPayload = {
      ...defaultPayload,
      ...(overrides.title && { title: overrides.title.trim() }),
      slug: targetSlug,
      category: targetCategory,
      ...(overrides.excerpt !== undefined && { excerpt: overrides.excerpt }),
      tags,
      ...(overrides.status && { status: overrides.status }),
      ...(overrides.publishedAt && { publishedAt: overrides.publishedAt }),
      updatedAt: overrides.updatedAt ?? new Date().toISOString(),
      ...(overrides.coverImage !== undefined && { coverImage: overrides.coverImage }),
      ...(overrides.readingTime !== undefined && { readingTime: overrides.readingTime }),
      ...(overrides.body !== undefined && { body: overrides.body }),
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
    console.error('[blobosphere] PUT failed', { category, slug, message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ category: string; slug: string }> },
) {
  const { category, slug } = await params;
  const blocked = guardLocalCms(_req);
  if (blocked) return blocked;
  try {
    const filePath = await resolveFile(category, slug);
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
    console.error('[blobosphere] DELETE failed', { category, slug, message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
