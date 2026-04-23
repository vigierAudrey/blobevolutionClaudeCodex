/**
 * Content Security Policy utilities.
 *
 * Security model:
 *  - script-src: 'self' + per-request nonce — blocks all inline/external script injection.
 *    This is the primary XSS mitigation: even if an attacker injects <script>…</script>,
 *    the browser rejects it because it lacks the server-generated nonce.
 *  - style-src: 'unsafe-inline' is retained — Next.js App Router injects inline <style>
 *    tags for CSS Modules/Tailwind; removing them would require a full nonce-for-styles
 *    pipeline. CSS-based attacks (data exfil via attribute selectors) are lower severity
 *    than script injection and are an acceptable residual risk here.
 *  - object-src 'none' — blocks legacy plugins (Flash, Java applets).
 *  - frame-ancestors 'none' — prevents clickjacking.
 *
 * Edge Runtime + Node.js compatible (uses Web Crypto API, no Node built-ins).
 */

/**
 * Generates a cryptographically unique nonce per request.
 * Uses Web Crypto `randomUUID` — available in Edge Runtime, Node.js 18+, and jsdom.
 */
export function generateNonce(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Builds the CSP header value for a given nonce.
 * Reads NEXT_PUBLIC_API_URL and optional NEXT_PUBLIC_MEDIA_URL from the environment
 * (both are bundled at build time by Next.js for client-side use).
 */
export function buildCsp(nonce: string): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  // Derive HTTP origin and WebSocket origin from the API URL.
  let apiOrigin = apiUrl;
  let wsOrigin = apiUrl.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws'));
  try {
    const u = new URL(apiUrl);
    apiOrigin = u.origin; // e.g. "https://api.blobinfini.com"
    wsOrigin = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`; // e.g. "wss://api.blobinfini.com"
  } catch {
    // Fallback: keep the raw string (handles localhost:4000 without protocol)
  }

  // Optional separate media/CDN origin for user photos (S3, MinIO, CDN).
  // Set NEXT_PUBLIC_MEDIA_URL in production if photos are served from a
  // different origin than NEXT_PUBLIC_API_URL (e.g. an S3 bucket or CDN).
  const mediaUrl = process.env.NEXT_PUBLIC_MEDIA_URL;
  let mediaOrigin: string | null = null;
  if (mediaUrl) {
    try {
      mediaOrigin = new URL(mediaUrl).origin;
    } catch {
      // ignore malformed value
    }
  }

  const imgSrcParts = [
    "'self'",
    'data:',                        // Next.js image placeholders, inline SVG via data URI
    'blob:',                        // Object URLs (canvas, generated images)
    'localhost:9000',               // MinIO (dev / pre-vps)
    'cdnjs.cloudflare.com',        // Leaflet marker icon images
    '*.tile.openstreetmap.org',    // OpenStreetMap tile images (Leaflet TileLayer)
    ...(mediaOrigin ? [mediaOrigin] : []),
  ];

  const directives = [
    `default-src 'self'`,

    // Nonce-based: only scripts tagged with the per-request nonce are allowed.
    // Next.js 14 App Router automatically applies this nonce to its own
    // generated hydration <script> tags when the header is set in middleware.
    // 'unsafe-eval' is required in dev for Next.js HMR / react-refresh (eval-based
    // hot module replacement). Never included in production.
    `script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,

    // 'unsafe-inline' is required for Next.js CSS-in-JS / Tailwind inline styles.
    // unpkg.com is needed for Leaflet CSS loaded dynamically in LocationPickerMap.
    `style-src 'self' 'unsafe-inline' unpkg.com`,

    `img-src ${imgSrcParts.join(' ')}`,

    // Both HTTP (fetch/XHR/polling) and WS (Socket.IO websocket transport).
    // mediaOrigin (MinIO/S3) is included because presigned PUT uploads go directly
    // from the browser to the storage endpoint — blocked otherwise.
    `connect-src 'self' ${apiOrigin} ${wsOrigin}${mediaOrigin ? ` ${mediaOrigin}` : ''}`,

    // next/font serves fonts from /_next/static — covered by 'self'.
    // data: handles occasional inline font references.
    `font-src 'self' data:`,

    // Clickjacking protection (CSP3 — preferred over X-Frame-Options).
    `frame-ancestors 'none'`,

    // Prevent <base> tag injection from hijacking relative URLs.
    `base-uri 'self'`,

    // Restrict where forms can submit to.
    `form-action 'self'`,

    // No Flash / Java applets.
    `object-src 'none'`,

    // Service workers from same origin only; blob: for dynamic SW registration.
    `worker-src 'self' blob:`,
  ];

  return directives.join('; ');
}
