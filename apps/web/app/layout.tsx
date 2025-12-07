import type { Metadata } from 'next';
import dynamicImport from 'next/dynamic';
import Script from 'next/script';
import './globals.css';
import ClientProvider from '@/components/ui/ClientProvider';
import { ThemeScript } from '@/components/theme/ThemeScript';

// Force dynamic rendering for all pages (no static generation)
export const dynamic = 'force-dynamic';
export const dynamicParams = true;
const CookieConsent = dynamicImport(
  () => import('../components/cookies/CookieConsent').then((mod) => mod.CookieConsent),
  { ssr: false },
);

// Root layout provides HTML shell + ClientProvider for all pages
// Static pages in (static)/ use ISR with revalidate=300 and avoid using contexts

export const metadata: Metadata = {
  title: 'BlobConnect — Auth',
  description: 'Inscription, connexion et gestion du compte',
  icons: {
    icon: '/favicon.ico',
    apple: [
      { url: '/apple-icon-180.png', sizes: '180x180' },
      { url: '/apple-icon-512.png', sizes: '512x512' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const adsenseClientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const adsenseEnabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';

  return (
    <html lang="fr">
      <head>
        {/* Apply theme class before paint to avoid FOUC */}
        <ThemeScript />
        {adsenseEnabled && adsenseClientId && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClientId}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
      </head>
      {/* Use design tokens so dark mode can flip background/foreground */}
      <body className="min-h-screen bg-background text-foreground">
        <ClientProvider>
          <main className="container-responsive py-6 sm:py-10">{children}</main>
          <CookieConsent />
        </ClientProvider>
      </body>
    </html>
  );
}
