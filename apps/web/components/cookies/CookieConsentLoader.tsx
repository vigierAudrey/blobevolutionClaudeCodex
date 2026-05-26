'use client';
import dynamic from 'next/dynamic';

// Client Component wrapper: dynamic with ssr:false must live in a Client Component.
// Server Components (layout.tsx) import from here instead of calling dynamic() directly.
const CookieConsentDynamic = dynamic(
  () => import('./CookieConsent').then((mod) => mod.CookieConsent),
  { ssr: false },
);

export { CookieConsentDynamic as CookieConsent };
