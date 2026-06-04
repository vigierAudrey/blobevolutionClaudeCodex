import type { Metadata } from 'next';
import Script from 'next/script';
import { headers } from 'next/headers';
import './globals.css';
import ClientProvider from '@/components/ui/ClientProvider';
import { RouteAnnouncer } from '@/components/accessibility/RouteAnnouncer';
import { SkipLink } from '@/components/accessibility/SkipLink';
import { ThemeScript } from '@/components/theme/ThemeScript';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { CookieConsent } from '@/components/cookies/CookieConsentLoader';

// Force dynamic rendering for all pages (no static generation)
export const dynamic = 'force-dynamic';
export const dynamicParams = true;

// Root layout provides HTML shell + ClientProvider for all pages
// Static pages in (static)/ use ISR with revalidate=300 and avoid using contexts

export const metadata: Metadata = {
  title: 'Blob · Auth',
  description: 'Inscription, connexion et gestion du compte',
  manifest: '/site.webmanifest',
  icons: {
    icon: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const adsenseClientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const adsenseEnabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';

  // Read the per-request nonce set by middleware so inline scripts can be
  // tagged with it and pass the Content-Security-Policy nonce check.
  // Falls back to undefined when middleware is not running (e.g. tests).
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} translate="no">
      <head>
        {/* Apply theme class before paint to avoid FOUC */}
        <ThemeScript nonce={nonce} />
        {adsenseEnabled && adsenseClientId && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClientId}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
            nonce={nonce}
          />
        )}
      </head>
      {/* Use design tokens so dark mode can flip background/foreground */}
      <body className="min-h-screen bg-background text-foreground">
        <SkipLink />
        <RouteAnnouncer />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ClientProvider>
            <main id="main-content" tabIndex={-1} className="container-responsive py-6 sm:py-10">
              {children}
            </main>
            <CookieConsent />
          </ClientProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
