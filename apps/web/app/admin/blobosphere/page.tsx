import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default function BlobosphereAdminDecapPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Blobosphère — Décap CMS</h1>
        <p className="text-muted-foreground">
          L’éditeur Git (Décap CMS) est isolé du reste de l’admin pour éviter toute requête API parasite.
          Utilise cette page pour te connecter via GitHub et modifier les fichiers `.mdx` de la Blobosphère.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accès éditeurs</CardTitle>
          <CardDescription>
            Choisis l’expérience qui te convient pour créer ou éditer les articles. Les deux alimentent les fichiers
            `apps/web/content/blobosphere`.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium">Éditeur interne (SSO admin)</p>
            <p className="text-sm text-muted-foreground">
              Ouvre le formulaire MDX natif pour les tests ou pour pré-remplir un article sans passer par GitHub.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/admin/blobosphere/editor">Ouvrir l’éditeur interne</Link>
          </Button>
        </CardContent>
        <CardContent className="flex flex-col gap-3 border-t pt-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium">Décap CMS (GitHub)</p>
            <p className="text-sm text-muted-foreground">
              Authentification GitHub + commits directs sur le repo. Fonctionne via le proxy `/api/decap/auth`.
            </p>
          </div>
          <Button asChild>
            <Link href="/admin/index.html" target="_blank" rel="noreferrer">
              Ouvrir dans un nouvel onglet
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Décap CMS</CardTitle>
          <CardDescription>
            Si l’iframe n’affiche pas l’auth GitHub, utilise le bouton ci-dessus pour l’ouvrir dans un nouvel onglet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/20">
            <iframe
              title="Decap CMS"
              src="/admin/index.html"
              className="w-full"
              style={{ minHeight: '80vh', border: '0' }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
