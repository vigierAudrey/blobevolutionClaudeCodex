"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';

export const dynamic = 'force-dynamic';

type AdminUser = { email: string; role: 'ADMIN' | 'PRO' | 'RIDER' };

export default function BlobosphereAdminEditor() {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }
        const me = (await apiClient.me()) as AdminUser;
        if (me.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }
        setUser(me);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Accès refusé');
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };
    check();
  }, [router]);

  if (loading) return <p>Chargement…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Blobosphère — Éditeur</h1>
          <p className="text-muted-foreground">Connecté en tant que {user?.email}</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Éditeur interne (SSO Admin)</CardTitle>
          <CardDescription>
            Créer/éditer des articles MDX et ouvrir une PR GitHub automatiquement.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button asChild>
            <a href="/admin/blobosphere/editor">Ouvrir l’éditeur interne</a>
          </Button>
          <p className="text-sm text-muted-foreground">
            Recommandé — tout est géré par votre compte admin.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Décap CMS (MDX + Git)</CardTitle>
          <CardDescription>
            L’éditeur charge la configuration depuis <code>/admin/config.yml</code>. Les droits d’écriture restent gérés par Git.
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
          <div className="mt-3 flex items-center gap-3">
            <Button asChild variant="outline">
              <a href="/admin/index.html" target="_blank" rel="noreferrer">Ouvrir dans un nouvel onglet</a>
            </Button>
            <p className="text-sm text-muted-foreground">
              Astuce: si l’iframe ne se charge pas, utilisez le bouton ci‑dessus.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
