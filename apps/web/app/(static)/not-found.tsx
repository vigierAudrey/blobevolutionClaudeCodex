import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-6xl font-bold text-gray-900 mb-4">404</h1>
      <h2 className="text-2xl font-semibold text-gray-700 mb-4">Page non trouvée</h2>
      <p className="text-muted-foreground mb-8 max-w-md">
        La page que vous recherchez n'existe pas ou a été déplacée.
      </p>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-6 py-3 hover:bg-primary/90 transition-colors"
      >
        Retour à l'accueil
      </Link>
    </div>
  );
}
