'use client';
import dynamic from 'next/dynamic';

// Client Component wrappers: dynamic with ssr:false must live in a Client Component.
// Server Components ((static)/page.tsx, blobosphere/page.tsx) import from here.
const AdBannerSidebar = dynamic(
  () => import('./AdBanner').then((m) => m.AdBannerSidebar),
  { ssr: false },
);

const AdBannerFeed = dynamic(
  () => import('./AdBanner').then((m) => m.AdBannerFeed),
  { ssr: false },
);

export { AdBannerSidebar, AdBannerFeed };
