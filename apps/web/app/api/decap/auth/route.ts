import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DECAP_AUTH_URL = 'https://api.netlify.com/api/v1/auth/github';

// L'éditeur Decap interne est désactivé en production (cf.
// app/admin/blobosphere/page.tsx) : ce proxy OAuth ne doit pas rester
// exposé sans lui. Host upstream fixe — jamais dérivé de la requête.
export function isDecapAuthProxyEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

async function proxyAuth(req: NextRequest) {
  if (!isDecapAuthProxyEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const target = new URL(DECAP_AUTH_URL);
  if (req.nextUrl.search) {
    target.search = req.nextUrl.search;
  }

  const needsBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
  const body = needsBody ? await req.text() : undefined;
  const upstream = await fetch(target.toString(), {
    method: req.method,
    headers: {
      'Content-Type': req.headers.get('content-type') ?? 'application/json',
    },
    body,
    redirect: 'manual',
  });

  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    resHeaders.set(key, value);
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export function GET(req: NextRequest) {
  return proxyAuth(req);
}

export function POST(req: NextRequest) {
  return proxyAuth(req);
}
