import { NextRequest, NextResponse } from 'next/server';

// SECURITY NOTE: This middleware is intentionally minimal.
// Real authentication happens server-side via JWT tokens in API calls.
// We no longer use client-side cookies for admin gating as they are insecure.
// Each admin page must verify authentication by calling the API with JWT tokens.

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only process /admin paths (matcher also restricts, but keep a defensive check)
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  // Let all /admin requests through - authentication will be verified by:
  // 1. Client-side: pages will call API with JWT Bearer tokens
  // 2. Server-side: API endpoints require requireAuth + requireAdmin middlewares
  // This middleware serves only as a routing matcher, not a security boundary.
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};

