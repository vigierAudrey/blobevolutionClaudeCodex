import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '../components/ui/toast';
import Script from 'next/script';
import { CookieConsent } from '../components/cookies/CookieConsent';

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
        <ToastProvider>
          <main className="container-responsive py-6 sm:py-10">{children}</main>
          <CookieConsent />
        </ToastProvider>
      </body>
    </html>
  );
}
