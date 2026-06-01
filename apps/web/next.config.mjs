import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Mode standalone pour déploiement Docker/production
  output: 'standalone',
  // Désactiver le prerendering statique au build
  // Toutes les pages seront SSR ou CSR à la demande
  experimental: {
    // Autoriser l'import de modules en dehors du répertoire Next (monorepo)
    externalDir: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
        pathname: '/blobinfini-dev/**',
      },
    ],
  },
  async headers() {
    return [
      {
        // Browsers must always re-fetch sw.js to detect service worker updates.
        // Without no-store, CDNs (Cloudflare) cache the file for hours and delay
        // SW updates reaching users after a deploy.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
