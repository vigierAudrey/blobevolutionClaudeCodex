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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient, type AuditLogEntry, type AuditLogResponse } from '@/lib/apiClient';
import { ArrowLeft, History } from 'lucide-react';

const ACTION_FILTERS = [
  { value: 'all', label: 'Toutes les actions' },
  { value: 'approve', label: 'Signalement approuvé' },
  { value: 'dismiss', label: 'Signalement rejeté' },
  { value: 'ban', label: 'Utilisateur banni' }
];

export default function AdminReportHistoryPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState<string>('all');

  useEffect(() => {
    const ensureAdmin = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }
        const user = await apiClient.me();
        if (user.role !== 'ADMIN') {
          router.replace('/dashboard');
        }
      } catch {
        router.replace('/login');
      }
    };

    ensureAdmin();
  }, [router]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getAuditLogs({
        page,
        limit: 25,
        action: 'admin:report:action'
      }) as AuditLogResponse;
      setLogs(response.items || []);
      setTotalPages(response.pagination?.totalPages ?? 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Impossible de charger l’historique');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      const moderationAction = String(entry.metadata?.moderationAction || '').toLowerCase();
      const matchesAction = filterAction === 'all' || moderationAction === filterAction;
      if (!matchesAction) return false;
      if (!search.trim()) return true;
      const term = search.trim().toLowerCase();
      return (
        entry.resource.toLowerCase().includes(term) ||
        entry.user?.email?.toLowerCase().includes(term) ||
        moderationAction.includes(term)
      );
    });
  }, [logs, filterAction, search]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/dashboard">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => loadHistory()} disabled={loading}>
          Actualiser
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <History className="h-8 w-8 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold">Historique de modération</h1>
          <p className="text-muted-foreground">
            Toutes les actions d’approbation, rejet et bannissement effectuées sur les signalements.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
          <CardDescription>Affiner la recherche dans l’historique.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Rechercher par report ou email admin"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select value={filterAction} onValueChange={(value) => { setFilterAction(value); setPage(1); }}>
            <SelectTrigger className="md:max-w-xs">
              <SelectValue placeholder="Type d’action" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_FILTERS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {(error || filteredLogs.length === 0) && (
        <Card>
          <CardContent className="pt-6">
            {error ? (
              <p className="text-red-600">{error}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune action trouvée.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {filteredLogs.map((log) => {
          const moderationAction = String(log.metadata?.moderationAction || '').toLowerCase();
          return (
            <Card key={log.id}>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Action</p>
                    <p className="font-medium capitalize">{moderationAction || 'inconnue'}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('fr-FR')}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Report</p>
                    <p className="font-mono text-xs break-all">{log.resource}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Admin</p>
                    <p className="text-sm">
                      {log.user?.email ?? 'Compte inconnu'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Détails</p>
                    <p className="text-sm text-muted-foreground">
                      Statut HTTP&nbsp;{log.metadata?.statusCode}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button
          variant="outline"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
        >
          Précédent
        </Button>
        <p className="text-sm text-muted-foreground">
          Page {page} / {totalPages}
        </p>
        <Button
          variant="outline"
          onClick={() => setPage((p) => (p < totalPages ? p + 1 : p))}
          disabled={page >= totalPages || loading}
        >
          Suivant
        </Button>
      </div>
    </div>
  );
}
