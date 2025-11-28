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
import { Badge } from '@/components/ui/badge';
import { apiClient, type AuditLogEntry, type ConversationBlockHistoryResponse } from '@/lib/apiClient';
import { ArrowLeft, History } from 'lucide-react';

export default function AdminConversationHistoryPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const ensureAdmin = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }
        const current = await apiClient.me();
        if (current.role !== 'ADMIN') {
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
      const response = await apiClient.getConversationBlockHistory({ page, limit: 25 }) as ConversationBlockHistoryResponse;
      setLogs(response.items ?? []);
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
    if (!search.trim()) return logs;
    const term = search.trim().toLowerCase();
    return logs.filter((log) => {
      const targetUsers = Array.isArray(log.metadata?.targetUserIds)
        ? (log.metadata?.targetUserIds as string[]).join(',')
        : '';
      return (
        log.resource.toLowerCase().includes(term) ||
        (log.metadata?.conversationId as string | undefined)?.toLowerCase().includes(term) ||
        targetUsers.toLowerCase().includes(term) ||
        (log.user?.email?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [logs, search]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/conversations/blocked">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour blocages
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => loadHistory()} disabled={loading}>
          Actualiser
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <History className="h-8 w-8 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold">Historique des blocages</h1>
          <p className="text-muted-foreground">
            Traçabilité complète des blocages/déblocages de conversation effectués par l’équipe ou automatiquement.
          </p>
        </div>
      </div>

  <Card>
        <CardHeader>
          <CardTitle>Recherche</CardTitle>
          <CardDescription>Filtrer par conversation, utilisateur ou admin.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-center">
          <Input
            placeholder="Email admin, conversationId, cible…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="ghost" onClick={() => setSearch('')} disabled={!search.length}>
            Effacer
          </Button>
        </CardContent>
      </Card>

      {(error || filteredLogs.length === 0) && (
        <Card>
          <CardContent className="pt-6">
            {error ? (
              <p className="text-red-600">{error}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {filteredLogs.map((log) => {
          const action = String(log.metadata?.action ?? '').toUpperCase();
          const conversationId = (log.metadata?.conversationId as string | undefined) ?? log.resource;
          const targets = Array.isArray(log.metadata?.targetUserIds)
            ? (log.metadata?.targetUserIds as string[])
            : [];

          return (
            <Card key={log.id}>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Badge variant={action === 'UNBLOCK' ? 'secondary' : 'default'} className="uppercase">
                    {action || 'BLOCAGE'}
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('fr-FR')}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">Conversation</p>
                    <p className="font-mono text-xs break-all">{conversationId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Admin</p>
                    <p className="text-sm">{log.user?.email ?? 'Compte système'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Cibles</p>
                    <p className="text-sm font-mono break-all">
                      {targets.length ? targets.join(', ') : 'Tous les membres'}
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
