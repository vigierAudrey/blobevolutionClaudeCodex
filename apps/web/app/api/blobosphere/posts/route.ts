import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { listMdxFiles } from '@/lib/blobosphere/fs';
import { buildCreatePayload } from '@/lib/blobosphere/payload';
import { saveMdx } from '@/lib/blobosphere/saveMdx';
import { BLOBOSPHERE_CONTENT_ROOT, BlobosphereCategory } from '@/lib/blobosphere/utils';

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

type ListItem = {
  category: BlobosphereCategory;
  slug: string;
  title: string;
  status: string;
  publishedAt: string | null;
  path: string;
};

export async function GET(req: NextRequest) {
  const blocked = guardLocalCms(req);
  if (blocked) return blocked;

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

export async function POST(req: NextRequest) {
  const blocked = guardLocalCms(req);
  if (blocked) return blocked;

  try {
    const payload = buildCreatePayload(await req.json());
    const filePath = await saveMdx(payload, { overwrite: false });
    return NextResponse.json({
      success: true,
      item: payload,
      path: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
    const status = message.includes('existe déjà') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
