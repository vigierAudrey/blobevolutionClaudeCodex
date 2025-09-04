import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Blobinfini — Auth',
  description: 'Inscription, connexion et gestion du compte',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <main className="container-responsive py-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}

