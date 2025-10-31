/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Mode standalone pour déploiement Docker/production
  output: 'standalone',
  // Désactiver le prerendering statique au build
  // Toutes les pages seront SSR ou CSR à la demande
  experimental: {
    // Désactiver l'optimisation ISR par défaut
    isrFlushToDisk: false,
  },
};

export default nextConfig;

