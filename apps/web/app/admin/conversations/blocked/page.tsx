"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { apiClient, type AdminBlockedConversation, type ConversationBlockHistoryItem } from '@/lib/apiClient';
import { AlertTriangle, ArrowLeft, History, RefreshCcw } from 'lucide-react';

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('fr-FR') : 'Date inconnue';

export default function AdminBlockedConversationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'history' ? 'history' : 'active';

  const [blocked, setBlocked] = useState<AdminBlockedConversation[]>([]);
  const [history, setHistory] = useState<ConversationBlockHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [historyReliability, setHistoryReliability] = useState<{
    hasLegacyRows: boolean;
    reliableSinceDate: string;
    reliableSinceVersion: string;
  } | null>(null);

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
    void ensureAdmin();
  }, [router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'history') {
        const response = await apiClient.getConversationBlockHistory({ page, limit: 25 });
        setHistory(response.items ?? []);
        setHistoryReliability(response.historyReliability);
        setTotalPages(response.pagination?.totalPages ?? 1);
      } else {
        const response = await apiClient.getBlockedConversations(100);
        setBlocked(response.blocked ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  }, [page, tab]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredBlocked = useMemo(() => {
    if (!search.trim()) return blocked;
    const term = search.trim().toLowerCase();
    return blocked.filter((item) => {
      const members = item.conversation?.members ?? [];
      return (
        item.user.email.toLowerCase().includes(term) ||
        item.conversationId.toLowerCase().includes(term) ||
        members.some((member) => member.user.email.toLowerCase().includes(term))
      );
    });
  }, [blocked, search]);

  const filteredHistory = useMemo(() => {
    if (!search.trim()) return history;
    const term = search.trim().toLowerCase();
    return history.filter((item) =>
      item.conversationId.toLowerCase().includes(term) ||
      item.user?.email?.toLowerCase().includes(term) ||
      item.actorUser?.email?.toLowerCase().includes(term) ||
      item.source.toLowerCase().includes(term),
    );
  }, [history, search]);

  const handleUnblock = async (conversationId: string, userId: string) => {
    setProcessingKey(`${conversationId}:${userId}`);
    setError(null);
    try {
      await apiClient.adminSetConversationBlock(conversationId, { action: 'unblock', userId });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du déblocage');
    } finally {
      setProcessingKey(null);
    }
  };

  const handleUnblockAll = async () => {
    if (!confirm('Débloquer toutes les conversations actives ?')) return;
    setBulkLoading(true);
    setError(null);
    setBulkMessage(null);
    try {
      const response = await apiClient.adminUnblockAllConversations();
      setBulkMessage(`Déblocage massif terminé (${response.processedCount} entrées, batch ${response.batchId}).`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de débloquer toutes les conversations');
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Blocages actifs</h1>
          <p className="text-muted-foreground text-sm">
            État courant des blocages et historique métier des événements de blocage.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => loadData()} disabled={loading}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/admin/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour dashboard
            </Link>
          </Button>
          <Button variant={tab === 'active' ? 'default' : 'outline'} size="sm" asChild>
            <Link href="/admin/conversations/blocked">Blocages actifs</Link>
          </Button>
          <Button variant={tab === 'history' ? 'default' : 'outline'} size="sm" asChild>
            <Link href="/admin/conversations/blocked?tab=history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
          {tab === 'active' && (
            <Button variant="destructive" size="sm" onClick={() => handleUnblockAll()} disabled={bulkLoading}>
              {bulkLoading ? 'Déblocage…' : 'Débloquer tout'}
            </Button>
          )}
        </div>
      </div>

      {tab === 'history' && historyReliability?.hasLegacyRows && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Historique partiellement legacy</p>
              <p>
                Historique complet garanti à partir du {historyReliability.reliableSinceDate}.
                Les entrées legacy marquent un état actif migré, pas un historique reconstruit complet.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recherche</CardTitle>
          <CardDescription>
            Filtrer par conversation, participant, admin ou source d’événement.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder="Email, conversationId, source…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="ghost" onClick={() => setSearch('')} disabled={!search.length}>
            Effacer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'history' ? 'Historique des blocages' : 'Blocages actifs'}</CardTitle>
          <CardDescription>
            {loading
              ? 'Chargement en cours…'
              : `${tab === 'history' ? filteredHistory.length : filteredBlocked.length} élément(s) affiché(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {bulkMessage && !error && tab === 'active' && (
            <p className="text-sm text-green-600">{bulkMessage}</p>
          )}

          {!loading && tab === 'active' && filteredBlocked.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun blocage correspondant.</p>
          )}
          {!loading && tab === 'history' && filteredHistory.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun événement correspondant.</p>
          )}

          {tab === 'active' && filteredBlocked.map((item) => (
            <div key={`${item.conversationId}-${item.user.id}`} className="border rounded-md p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Conversation</p>
                  <p className="font-mono text-sm">{item.conversationId}</p>
                </div>
                <Badge variant="secondary">
                  {item.conversation?.type?.toLowerCase().replace(/_/g, ' ') ?? 'conversation'}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Utilisateur bloquant</p>
                  <p className="font-medium">{item.user.email}</p>
                  <p className="text-xs text-muted-foreground">Rôle: {item.user.role}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Autres participants</p>
                  <ul className="text-sm space-y-1">
                    {(item.conversation?.members ?? [])
                      .filter((member) => member.user.id !== item.user.id)
                      .map((member) => (
                        <li key={member.user.id}>
                          {member.user.email}
                          {member.blockedAt && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              bloqué
                            </Badge>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted-foreground">Bloqué le {formatDate(item.blockedAt)}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleUnblock(item.conversationId, item.user.id)}
                  disabled={processingKey === `${item.conversationId}:${item.user.id}`}
                >
                  Débloquer
                </Button>
              </div>
            </div>
          ))}

          {tab === 'history' && filteredHistory.map((item) => (
            <div key={item.id} className="border rounded-md p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={item.action === 'UNBLOCK' ? 'secondary' : 'default'}>
                  {item.action}
                </Badge>
                <p className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Conversation</p>
                  <p className="font-mono break-all">{item.conversationId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cible</p>
                  <p>{item.user?.email || item.userId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Acteur</p>
                  <p>{item.actorUser?.email || item.actorType}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Source</p>
                  <p>{item.source}</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {tab === 'history' && (
        <div className="flex items-center justify-between pt-4">
          <Button
            variant="outline"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
          >
            Précédent
          </Button>
          <p className="text-sm text-muted-foreground">
            Page {page} / {totalPages}
          </p>
          <Button
            variant="outline"
            onClick={() => setPage((current) => (current < totalPages ? current + 1 : current))}
            disabled={page >= totalPages || loading}
          >
            Suivant
          </Button>
        </div>
      )}
    </div>
  );
}
