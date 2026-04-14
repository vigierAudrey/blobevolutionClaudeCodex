"use client";

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient, type SecurityHealth } from '@/lib/apiClient';
import { ArrowLeft, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';

export const dynamic = 'force-dynamic';

const CHECK_LABELS: Record<keyof SecurityHealth['checks'], { label: string; description: string; showAlways: boolean }> = {
  db:     { label: 'Base de données',   description: 'PostgreSQL répond aux requêtes.',                showAlways: true },
  redis:  { label: 'Cache serveur',     description: 'Redis répond aux requêtes.',                     showAlways: true },
  // config et env vérifient la configuration des secrets/origines ; toujours OK hors production
  config: { label: 'Configuration',    description: 'Origines CORS, proxies, vérification email.',    showAlways: false },
  env:    { label: 'Variables secrètes', description: 'Longueur et présence des secrets critiques.',   showAlways: false },
};

function CheckRow({ name, value, meta }: {
  name: keyof SecurityHealth['checks'];
  value: 'ok' | 'fail';
  meta: typeof CHECK_LABELS[keyof typeof CHECK_LABELS];
}) {
  const ok = value === 'ok';
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-b-0">
      {ok
        ? <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
        : <XCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />}
      <div className="flex-1">
        <p className="text-sm font-medium">{meta.label}</p>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
        {name === 'config' || name === 'env' ? (
          <p className="text-xs text-muted-foreground italic mt-0.5">
            Ce check est toujours OK hors production — il vérifie la configuration du serveur, pas l'infrastructure.
          </p>
        ) : null}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {ok ? 'OK' : 'Problème'}
      </span>
    </div>
  );
}

export default function AdminHealthPage() {
  const router = useRouter();
  const [health, setHealth] = useState<SecurityHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await apiClient.getSecurityHealth();
      setHealth(h);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de récupérer la santé système');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ensureAdmin = async () => {
      try {
        // No local hint check — truth comes from the server session.
        const me = await apiClient.me();
        if (me.role !== 'ADMIN') { router.replace('/dashboard'); return; }
      } catch { router.replace('/login'); }
    };
    ensureAdmin();
    void loadHealth();
  }, [router, loadHealth]);

  const dbOk    = health?.checks.db    === 'ok';
  const redisOk = health?.checks.redis === 'ok';
  const infraOk = dbOk && redisOk;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour dashboard
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={loadHealth} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Rafraîchir
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Santé système</h1>
        <p className="text-muted-foreground text-sm">
          État en temps réel des composants critiques de la plateforme.
        </p>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground mt-1">
            Vérifié à {lastUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}
      </div>

      {loading && !health && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Vérification en cours…
        </div>
      )}

      {error && (
        <Card className="border-red-200">
          <CardContent className="pt-6">
            <p className="text-red-600 text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {health && (
        <>
          {/* Synthèse */}
          <Card className={infraOk ? 'border-green-200' : 'border-red-200'}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {infraOk
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                  : <XCircle className="h-5 w-5 text-red-600" />}
                {infraOk ? 'Plateforme opérationnelle' : 'Problème détecté sur l\'infrastructure'}
              </CardTitle>
              <CardDescription>
                {infraOk
                  ? 'La base de données et le cache répondent correctement.'
                  : 'Un ou plusieurs composants critiques sont indisponibles. Vérifiez les détails ci-dessous.'}
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Détails des checks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Détail des vérifications</CardTitle>
            </CardHeader>
            <CardContent>
              {(Object.entries(health.checks) as [keyof SecurityHealth['checks'], 'ok' | 'fail'][]).map(([name, value]) => (
                <CheckRow key={name} name={name} value={value} meta={CHECK_LABELS[name]} />
              ))}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Les checks <strong>Configuration</strong> et <strong>Variables secrètes</strong> vérifient la conformité de
            la configuration serveur (origines autorisées, longueur des secrets). Ils sont toujours OK
            en dehors de la production et ne reflètent pas l'état de l'infrastructure en temps réel.
          </p>
        </>
      )}
    </div>
  );
}
