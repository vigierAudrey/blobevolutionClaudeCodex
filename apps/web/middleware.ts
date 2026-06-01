import { NextRequest, NextResponse } from 'next/server';
import { generateNonce, buildCsp } from './lib/csp';

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Generate a per-request nonce and build the CSP header.
  const nonce = generateNonce();
  const csp = buildCsp(
    nonce,
    pathname === '/admin/index.html'
      ? {
          scriptSrcExtra: ['https://unpkg.com'],
          connectSrcExtra: ['https://api.github.com', 'https://api.netlify.com'],
        }
      : {},
  );

  // --- Admin session guard ---
  // Defensive check (matcher also restricts to /admin paths).
  if (pathname.startsWith('/admin')) {
    const adminCookie = req.cookies.get('admin_session');
    if (adminCookie?.value !== '1') {
      // Build a safe next param (path + search only)
      const next = `${pathname}${search ?? ''}`;
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = `?next=${encodeURIComponent(next)}`;
      const res = NextResponse.redirect(url);
      res.headers.set('Content-Security-Policy', csp);
      return res;
    }
  }

  // Propagate the nonce to server components via a request header so that
  // layout.tsx can read it and pass it to inline script elements (ThemeScript).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  /*
   * Match all request paths EXCEPT Next.js internals and static file extensions.
   * Both CSP injection and admin-session redirect are handled here.
   *
   * Excluded: _next/static, _next/image, favicon, robots, sitemap, and common
   * binary/media file extensions served from public/.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|eot)$).*)',
  ],
};
