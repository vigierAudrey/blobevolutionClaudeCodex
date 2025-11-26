import { NextRequest, NextResponse } from 'next/server';

const DECAP_AUTH_URL = 'https://api.netlify.com/api/v1/auth/github';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(DECAP_AUTH_URL, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    // Pass through Decap headers to avoid CORS surprises (authorization, etc.)
  });

  const data = await res.text();
  return new NextResponse(data, { status: res.status });
}

export const GET = POST;
