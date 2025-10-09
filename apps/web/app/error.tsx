'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to monitoring service
    console.error('Error boundary caught:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-6xl font-bold text-gray-900 mb-4">Oups!</h1>
      <h2 className="text-2xl font-semibold text-gray-700 mb-4">
        Une erreur est survenue
      </h2>
      <p className="text-muted-foreground mb-8 max-w-md">
        {error.message || "Quelque chose s'est mal passé. Veuillez réessayer."}
      </p>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-3 hover:bg-primary/90 transition-colors"
        >
          Réessayer
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 hover:bg-accent transition-colors"
        >
          Retour à l'accueil
        </Link>
      </div>
      {error.digest && (
        <p className="text-xs text-muted-foreground mt-8">
          Référence d'erreur : {error.digest}
        </p>
      )}
    </div>
  );
}
