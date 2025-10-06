import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Script from 'next/script';
import './globals.css';
import type { ClientProviderProps } from '@/components/ui/ClientProvider';
import { CookieConsent } from '../components/cookies/CookieConsent';

const ClientProvider = dynamic<ClientProviderProps>(
  () => import('@/components/ui/ClientProvider'),
  {
    ssr: false,
    loading: (props) => <>{(props as ClientProviderProps).children}</>,
  }
);

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
