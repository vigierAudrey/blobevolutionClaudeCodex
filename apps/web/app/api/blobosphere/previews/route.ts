import { NextResponse } from 'next/server';
import { loadBlobospherePreviews } from '@/lib/blobosphere/loadBlobospherePreviews';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');
  const items = await loadBlobospherePreviews();
  if (slug) {
    const item = items.find((article) => article.slug === slug) ?? null;
    return NextResponse.json({ item });
  }
  return NextResponse.json({ items });
}
