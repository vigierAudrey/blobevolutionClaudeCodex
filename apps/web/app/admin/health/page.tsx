"use client";

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient, type SecurityHealth, type SystemStatus, type SystemHealthLevel } from '@/lib/apiClient';
import {
  ArrowLeft, CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle, HelpCircle,
  HardDrive, Save, GitCommit, Bell,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

// ── Badges de statut ──────────────────────────────────────────────────────────
type Level = SystemHealthLevel | 'degraded' | 'not_configured';

function levelMeta(level: Level): { label: string; cls: string; Icon: typeof CheckCircle2 } {
  switch (level) {
    case 'ok':
      return { label: 'OK', cls: 'bg-green-100 text-green-800', Icon: CheckCircle2 };
    case 'warn':
    case 'degraded':
      return { label: 'Dégradé', cls: 'bg-yellow-100 text-yellow-800', Icon: AlertTriangle };
    case 'critical':
      return { label: 'Critique', cls: 'bg-red-100 text-red-800', Icon: XCircle };
    case 'not_configured':
      return { label: 'Non configuré', cls: 'bg-gray-100 text-gray-600', Icon: HelpCircle };
    default:
      return { label: 'Inconnu', cls: 'bg-gray-100 text-gray-600', Icon: HelpCircle };
  }
}

function Badge({ level }: { level: Level }) {
  const { label, cls } = levelMeta(level);
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

function StatusRow({ label, description, level }: { label: string; description?: string; level: Level }) {
  const { Icon, cls } = levelMeta(level);
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-b-0">
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${cls.split(' ')[1]}`} />
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Badge level={level} />
    </div>
  );
}

function formatAge(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `il y a ${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `il y a ${m} min`;
  return `il y a ${h} h ${m.toString().padStart(2, '0')}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminHealthPage() {
  const router = useRouter();
  const [sys, setSys] = useState<SystemStatus | null>(null);
  const [security, setSecurity] = useState<SecurityHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, sec] = await Promise.all([
        apiClient.getSystemStatus(),
        apiClient.getSecurityHealth().catch(() => null),
      ]);
      setSys(s);
      setSecurity(sec);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de récupérer l\'état système');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ensureAdmin = async () => {
      try {
        const me = await apiClient.me();
        if (me.role !== 'ADMIN') { router.replace('/dashboard'); return; }
      } catch { router.replace('/login'); }
    };
    ensureAdmin();
    void load();
  }, [router, load]);

  const readinessLevel: Level = sys?.readiness.status === 'critical'
    ? 'critical'
    : sys?.readiness.status === 'degraded' ? 'degraded' : 'ok';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour dashboard
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Rafraîchir
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">État système</h1>
        <p className="text-muted-foreground text-sm">
          Cockpit pré-production : infrastructure, sauvegardes, disque, version, alertes.
        </p>
        {lastUpdated && (
          <p className="text-xs text-muted-foreground mt-1">
            Vérifié à {lastUpdated.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        )}
      </div>

      {loading && !sys && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Vérification en cours…
        </div>
      )}

      {error && (
        <Card className="border-red-200">
          <CardContent className="pt-6"><p className="text-red-600 text-sm">{error}</p></CardContent>
        </Card>
      )}

      {sys && (
        <>
          {/* Synthèse readiness */}
          <Card className={readinessLevel === 'ok' ? 'border-green-200' : readinessLevel === 'critical' ? 'border-red-200' : 'border-yellow-200'}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  {readinessLevel === 'ok'
                    ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                    : readinessLevel === 'critical'
                      ? <XCircle className="h-5 w-5 text-red-600" />
                      : <AlertTriangle className="h-5 w-5 text-yellow-600" />}
                  {readinessLevel === 'ok'
                    ? 'Plateforme prête à servir le trafic'
                    : readinessLevel === 'critical'
                      ? 'Dépendance critique indisponible'
                      : 'Service dégradé (non bloquant)'}
                </span>
                <Badge level={readinessLevel} />
              </CardTitle>
            </CardHeader>
          </Card>

          {/* Infrastructure (readiness) */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Infrastructure</CardTitle></CardHeader>
            <CardContent>
              <StatusRow label="Base de données" description="PostgreSQL répond (dépendance critique)." level={sys.readiness.checks.database} />
              <StatusRow label="Cache serveur" description="Redis (fallback mémoire si indisponible)." level={sys.readiness.checks.redis} />
              <StatusRow label="Stockage objet" description="MinIO/S3 (médias)." level={sys.readiness.checks.storage} />
            </CardContent>
          </Card>

          {/* Sauvegarde PostgreSQL */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Save className="h-4 w-4" /> Sauvegarde PostgreSQL
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">{sys.backup.message}</span>
                <Badge level={sys.backup.health} />
              </div>
              <dl className="text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1">
                <dt>Dernier backup</dt>
                <dd className="text-foreground">{sys.backup.lastBackupAt ? formatAge(sys.backup.ageSeconds) : '—'}</dd>
                <dt>Taille</dt>
                <dd className="text-foreground">{sys.backup.sizeHuman ?? '—'}</dd>
                <dt>Checksum SHA-256</dt>
                <dd className="text-foreground">{sys.backup.hasChecksum ? 'présent' : 'absent'}</dd>
                {sys.backup.filename && (<><dt>Fichier</dt><dd className="text-foreground break-all">{sys.backup.filename}</dd></>)}
              </dl>
            </CardContent>
          </Card>

          {/* Disque + Déploiement */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <HardDrive className="h-4 w-4" /> Disque
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {sys.disk.usedPercent != null ? `${sys.disk.usedPercent}% utilisé` : 'Indisponible'}
                  </span>
                  <Badge level={sys.disk.health} />
                </div>
                {sys.disk.usedPercent != null && (
                  <div className="h-2 w-full rounded bg-gray-100 overflow-hidden">
                    <div
                      className={`h-full ${sys.disk.health === 'critical' ? 'bg-red-500' : sys.disk.health === 'warn' ? 'bg-yellow-500' : 'bg-green-500'}`}
                      style={{ width: `${sys.disk.usedPercent}%` }}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{sys.disk.message}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <GitCommit className="h-4 w-4" /> Déploiement
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>Commit : <code className="text-xs">{sys.version.commit}</code></p>
                <p className="text-xs text-muted-foreground">
                  {sys.version.deployedAt
                    ? `Déployé le ${new Date(sys.version.deployedAt).toLocaleString('fr-FR')}`
                    : 'Date de déploiement inconnue'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Alertes */}
          <Card className={sys.alerts.criticalOpen > 0 ? 'border-red-200' : undefined}>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bell className="h-4 w-4" /> Alertes système
              </CardTitle>
              <CardDescription>
                {sys.alerts.open} ouverte{sys.alerts.open > 1 ? 's' : ''}
                {sys.alerts.criticalOpen > 0 ? ` · ${sys.alerts.criticalOpen} critique${sys.alerts.criticalOpen > 1 ? 's' : ''}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/alerts">Voir les alertes</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Posture sécurité (config/env) — secondaire */}
          {security && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Posture sécurité (configuration)</CardTitle>
                <CardDescription>
                  Conformité de la configuration serveur. Toujours OK hors production.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StatusRow label="Configuration" description="Origines CORS, proxies, vérification email." level={security.checks.config === 'ok' ? 'ok' : 'critical'} />
                <StatusRow label="Variables secrètes" description="Longueur et présence des secrets critiques." level={security.checks.env === 'ok' ? 'ok' : 'critical'} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
