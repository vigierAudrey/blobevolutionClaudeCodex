import { NextRequest, NextResponse } from 'next/server';

// Guard all /admin routes at the edge: if no admin session cookie, redirect to /login
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Only process /admin paths (matcher also restricts, but keep a defensive check)
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const adminCookie = req.cookies.get('admin_session');

  if (adminCookie?.value === '1') {
    return NextResponse.next();
  }

  // Build a safe next param (path + search only)
  const next = `${pathname}${search ?? ''}`;
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin/:path*'],
};

