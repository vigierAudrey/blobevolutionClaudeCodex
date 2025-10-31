import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Script from 'next/script';
import './globals.css';
import ClientProvider from '@/components/ui/ClientProvider';

// Force dynamic rendering for all pages (no static generation)
export const dynamicParams = true;
const CookieConsent = dynamic(
  () => import('../components/cookies/CookieConsent').then((mod) => mod.CookieConsent),
  { ssr: false },
);

// Root layout provides HTML shell + ClientProvider for all pages
// Static pages in (static)/ use ISR with revalidate=300 and avoid using contexts

export const metadata: Metadata = {
  title: 'Blobinfini — Auth',
  description: 'Inscription, connexion et gestion du compte',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const adsenseClientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const adsenseEnabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';

  return (
    <html lang="fr">
      <head>
        {adsenseEnabled && adsenseClientId && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClientId}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <ClientProvider>
          <main className="container-responsive py-6 sm:py-10">{children}</main>
          <CookieConsent />
        </ClientProvider>
      </body>
    </html>
  );
}
