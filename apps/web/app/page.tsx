import Link from 'next/link';

export default function Home() {
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Bienvenue</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Accède à ton compte ou crée-en un nouveau. Interface optimisée mobile/tablette.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 w-full sm:w-auto">
          Se connecter
        </Link>
        <Link href="/register" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 w-full sm:w-auto">
          Créer un compte
        </Link>
      </div>
    </div>
  );
}
