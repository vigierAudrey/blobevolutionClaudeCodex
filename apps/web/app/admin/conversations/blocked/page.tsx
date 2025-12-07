"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { apiClient, type AdminBlockedConversation } from '@/lib/apiClient';
import { ArrowLeft, History, RefreshCcw } from 'lucide-react';

export default function AdminBlockedConversationsPage() {
  const [blocked, setBlocked] = useState<AdminBlockedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const loadBlocked = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getBlockedConversations(100);
      setBlocked(response.blocked ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBlocked();
  }, []);

  const filtered = useMemo(() => {
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

  const handleUnblock = async (conversationId: string, userId: string) => {
    setProcessingKey(`${conversationId}:${userId}`);
    setError(null);
    try {
      await apiClient.adminSetConversationBlock(conversationId, { action: 'unblock', userId });
      await loadBlocked();
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
      setBulkMessage(`Déblocage massif effectué (${response.count} entrées mises à jour).`);
      await loadBlocked();
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
          <h1 className="text-3xl font-bold">Conversations bloquées</h1>
          <p className="text-muted-foreground text-sm">
            Inspecte et débloque les conversations verrouillées par les utilisateurs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => loadBlocked()} disabled={loading}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/admin/dashboard">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour dashboard
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/conversations/history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
          <Button variant="destructive" size="sm" onClick={() => handleUnblockAll()} disabled={bulkLoading}>
            {bulkLoading ? 'Déblocage…' : 'Débloquer tout'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recherche</CardTitle>
          <CardDescription>
            Filtrer par email participant ou identifiant de conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder="Ex: dev+rider1@test.com ou uuid conversation"
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
          <CardTitle>Blocages actifs</CardTitle>
          <CardDescription>
            {loading ? 'Chargement en cours...' : `${filtered.length} blocage(s) listé(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {bulkMessage && !error && (
            <p className="text-sm text-green-600">{bulkMessage}</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun blocage correspondant.</p>
          )}
          <div className="space-y-3">
            {filtered.map((item) => (
              <div
                key={`${item.conversationId}-${item.user.id}`}
                className="border rounded-md p-4 space-y-3"
              >
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
                            {member.user.email}{' '}
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
                  <p className="text-muted-foreground">
                    Bloqué le{' '}
                    {item.blockedAt
                      ? new Date(item.blockedAt).toLocaleString('fr-FR')
                      : 'Date inconnue'}
                  </p>
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
