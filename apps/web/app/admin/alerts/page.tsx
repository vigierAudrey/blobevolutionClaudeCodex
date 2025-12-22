"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient, type SystemAlert } from '@/lib/apiClient';
import { ArrowLeft, Check, Clock3 } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Ouvertes' },
  { value: 'ACKNOWLEDGED', label: 'Reconnu' },
  { value: 'RESOLVED', label: 'Résolues' }
] as const;

const SEVERITY_COLORS: Record<SystemAlert['severity'], string> = {
  INFO: 'bg-blue-100 text-blue-800',
  WARNING: 'bg-yellow-100 text-yellow-800',
  CRITICAL: 'bg-red-100 text-red-800'
};

type StatusFilter = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
type SeverityFilter = 'INFO' | 'WARNING' | 'CRITICAL' | 'ALL';

export default function AdminAlertsPage() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('OPEN');
  const [severity, setSeverity] = useState<SeverityFilter>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const ensureAdmin = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }
        const me = await apiClient.me();
        if (me.role !== 'ADMIN') {
          router.replace('/dashboard');
        }
      } catch {
        router.replace('/login');
      }
    };
    ensureAdmin();
  }, [router]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getSystemAlerts({
        status,
        severity: severity === 'ALL' ? undefined : severity,
        page,
        limit: 20
      });
      setAlerts(response.items ?? []);
      setTotalPages(response.pagination?.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les alertes');
    } finally {
      setLoading(false);
    }
  }, [page, severity, status]);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const handleAcknowledge = async (id: string) => {
    try {
      await apiClient.acknowledgeAlert(id);
      void loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de mettre à jour l’alerte');
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await apiClient.resolveAlert(id);
      void loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de mettre à jour l’alerte');
    }
  };

  const filtered = useMemo(() => alerts, [alerts]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour dashboard
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => loadAlerts()} disabled={loading}>
          Rafraîchir
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold">Alertes système</h1>
        <p className="text-muted-foreground">
          Suivre et clôturer les incidents critiques détectés sur la plateforme.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
          <CardDescription>Ajustez en fonction du statut ou de la sévérité.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Statut</p>
            <Select value={status} onValueChange={(value: StatusFilter) => { setStatus(value); setPage(1); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sévérité</p>
            <Select value={severity} onValueChange={(value: SeverityFilter) => { setSeverity(value); setPage(1); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Toutes</SelectItem>
                <SelectItem value="INFO">Info</SelectItem>
                <SelectItem value="WARNING">Avertissement</SelectItem>
                <SelectItem value="CRITICAL">Critique</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {(error || filtered.length === 0) && (
        <Card>
          <CardContent className="pt-6">
            {error ? (
              <p className="text-red-600">{error}</p>
            ) : (
              <p className="text-muted-foreground text-sm">Aucune alerte pour ce filtre.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {filtered.map((alert) => (
          <Card key={alert.id}>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className={`text-xs px-2 py-1 rounded ${SEVERITY_COLORS[alert.severity]}`}>
                  {alert.severity}
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(alert.createdAt).toLocaleString('fr-FR')}
                </p>
              </div>
              <div>
                <p className="font-semibold">{alert.type}</p>
                <p className="text-sm text-muted-foreground">{alert.message}</p>
                {alert.link && (
                  <Link href={alert.link} className="text-xs text-blue-600 underline" target="_blank" rel="noreferrer">
                    Voir les détails
                  </Link>
                )}
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-muted-foreground">
                  Statut : {alert.status}
                </p>
                <div className="flex gap-2">
                  {alert.status === 'OPEN' && (
                    <Button size="sm" variant="outline" onClick={() => handleAcknowledge(alert.id)}>
                      <Clock3 className="h-4 w-4 mr-1" />
                      Reconnu
                    </Button>
                  )}
                  {alert.status !== 'RESOLVED' && (
                    <Button size="sm" variant="outline" onClick={() => handleResolve(alert.id)}>
                      <Check className="h-4 w-4 mr-1" />
                      Résoudre
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
          Précédent
        </Button>
        <p className="text-sm text-muted-foreground">
          Page {page} / {totalPages}
        </p>
        <Button variant="outline" onClick={() => setPage((p) => (p < totalPages ? p + 1 : p))} disabled={page >= totalPages || loading}>
          Suivant
        </Button>
      </div>
    </div>
  );
}
