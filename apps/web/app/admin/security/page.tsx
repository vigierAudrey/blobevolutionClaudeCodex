"use client";
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { apiClient, type SecurityHealth, type SecurityObservability } from '../../../lib/apiClient';
import { Shield, CheckCircle, AlertTriangle, RefreshCw, ChevronRight, FileText } from 'lucide-react';
import Link from 'next/link';

export default function AdminSecurityPage() {
  const [health, setHealth] = useState<SecurityHealth | null>(null);
  const [observability, setObservability] = useState<SecurityObservability | null>(null);
  const [loading, setLoading] = useState(true);

  const checkHealth = async () => {
    setLoading(true);
    try {
      const [healthResponse, observabilityResponse] = await Promise.all([
        apiClient.getSecurityHealth(),
        apiClient.getSecurityObservability(),
      ]);
      setHealth(healthResponse);
      setObservability(observabilityResponse);
    } catch (error: unknown) {
      console.error('Failed to fetch security health:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  if (loading) return <p>Chargement...</p>;

  const isSecure = health?.status === 'SECURE';
  const isDegraded = health?.status === 'DEGRADED';
  const checks = health?.checks ?? { config: 'fail', env: 'fail', db: 'fail', redis: 'fail' };
  const checkItems = [
    { key: 'config', label: 'Configuration', value: checks.config },
    { key: 'env', label: 'Secrets & env', value: checks.env },
    { key: 'db', label: 'Base de données', value: checks.db },
    { key: 'redis', label: 'Redis', value: checks.redis },
  ] as const;
  const pipeline = observability?.pipeline;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/admin/dashboard" className="hover:text-foreground transition-colors">Administration</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Sécurité</span>
      </nav>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sécurité Platform</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Surveillez la santé technique de la plateforme et accédez aux outils d&apos;investigation.
          </p>
        </div>
        <Button onClick={checkHealth} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Vérifier
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            État de Sécurité
            {isSecure ? (
              <Badge variant="default" className="bg-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                Sécurisé
              </Badge>
            ) : isDegraded ? (
              <Badge variant="secondary" className="bg-amber-500 text-white">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Dégradé — une dépendance est indisponible
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Unsafe — vérifiez la configuration
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Dernière mesure : {health?.timestamp ?? 'n/a'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {checkItems.map((item) => (
              <div key={item.key} className="text-center">
                <div className={`text-2xl font-bold ${item.value === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                  {item.value === 'ok' ? '✓' : '✗'}
                </div>
                <div className="text-sm text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            SECURE = posture conforme. DEGRADED = dépendance indisponible (DB ou Redis). UNSAFE = secrets ou configuration non conformes.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Observabilité Logs</CardTitle>
          <CardDescription>
            État du pipeline de transport des logs de sécurité.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Statut</div>
              <div className="text-lg font-semibold">{observability?.status ?? 'n/a'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Queued</div>
              <div className="text-lg font-semibold">{pipeline?.queued ?? 0}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Sent</div>
              <div className="text-lg font-semibold">{pipeline?.sent ?? 0}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Dropped</div>
              <div className="text-lg font-semibold">{pipeline?.dropped ?? 0}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Failed / Breaker</div>
              <div className="text-lg font-semibold">
                {(pipeline?.failed ?? 0)} / {pipeline?.breakerState ?? 'n/a'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Liens d'investigation — rôle de hub */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Investigation</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/admin/security/login-attempts">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4" />
                  Tentatives de connexion
                </CardTitle>
                <CardDescription>
                  Historique des logins, détection de bruteforce, empreintes IP suspectes.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/security/logs">
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />
                  Logs de sécurité
                </CardTitle>
                <CardDescription>
                  Journal des événements de sécurité, alertes système et audit trail.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
