"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { optimizedApiClient } from '../../../lib/optimizedApiClient';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import Link from 'next/link';
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

type ContactRequestItem = {
  id:             string;
  status:         'PENDING' | 'ACCEPTED' | 'REJECTED';
  message:        string | null;
  createdAt:      string;
  conversationId: string;
  archivedByPro:  boolean;
  riderName:      string;
};

type StatusFilter = 'active' | 'archived' | 'all';

const STATUS_LABEL: Record<ContactRequestItem['status'], string> = {
  PENDING:  'En attente',
  ACCEPTED: 'Acceptée',
  REJECTED: 'Refusée',
};

const STATUS_COLOR: Record<ContactRequestItem['status'], string> = {
  PENDING:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  ACCEPTED: 'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-300',
  REJECTED: 'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-300',
};

const PAGE_SIZE = 20;

export default function ProContactRequestsPage() {
  const router = useRouter();

  const [filter, setFilter]       = useState<StatusFilter>('active');
  const [page, setPage]           = useState(1);
  const [items, setItems]         = useState<ContactRequestItem[]>([]);
  const [total, setTotal]         = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading]     = useState(true);
  const [archiving, setArchiving] = useState<Record<string, boolean>>({});

  const load = useCallback(async (f: StatusFilter, p: number) => {
    setLoading(true);
    try {
      const data = await optimizedApiClient.getProContactRequests({ page: p, limit: PAGE_SIZE, status: f });
      setItems(data.items);
      setTotal(data.total);
      setPageCount(data.pageCount);
    } catch {
      // token expiré → retour login
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(filter, page); }, [filter, page, load]);

  const handleFilterChange = (f: StatusFilter) => {
    setFilter(f);
    setPage(1);
  };

  const handleArchive = async (id: string) => {
    setArchiving(prev => ({ ...prev, [id]: true }));
    try {
      await optimizedApiClient.archiveContactRequest(id);
      // Recharge la page courante — la demande disparaît du filtre 'active'
      await load(filter, page);
    } finally {
      setArchiving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleUnarchive = async (id: string) => {
    setArchiving(prev => ({ ...prev, [id]: true }));
    try {
      await optimizedApiClient.unarchiveContactRequest(id);
      await load(filter, page);
    } finally {
      setArchiving(prev => ({ ...prev, [id]: false }));
    }
  };

  const tabs: { label: string; value: StatusFilter; count?: number }[] = [
    { label: 'Actives',   value: 'active'   },
    { label: 'Archivées', value: 'archived' },
    { label: 'Toutes',    value: 'all',  count: total },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/pro/dashboard" className="text-muted-foreground hover:text-foreground">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Demandes de contact</h1>
            <p className="text-sm text-muted-foreground">
              {total} demande{total !== 1 ? 's' : ''} {filter === 'active' ? 'actives' : filter === 'archived' ? 'archivées' : 'au total'}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => handleFilterChange(tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                filter === tab.value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Liste */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <Inbox className="w-10 h-10 opacity-40" />
              <p className="text-sm">Aucune demande {filter === 'archived' ? 'archivée' : 'active'}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <Card key={item.id} className="transition-opacity">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base">{item.riderName}</CardTitle>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{new Date(item.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[item.status]}`}>
                      {STATUS_LABEL[item.status]}
                    </span>
                  </div>
                </CardHeader>
                {item.message && (
                  <CardContent className="pt-0 pb-2">
                    <p className="text-sm text-muted-foreground line-clamp-2">{item.message}</p>
                  </CardContent>
                )}
                <CardContent className="pt-0 flex justify-end gap-2">
                  <Link href={`/pro/messages?conversationId=${item.conversationId}`}>
                    <Button variant="ghost" size="sm" className="text-xs">Voir la conversation</Button>
                  </Link>
                  {item.archivedByPro ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs gap-1"
                      disabled={archiving[item.id]}
                      onClick={() => handleUnarchive(item.id)}
                    >
                      <ArchiveRestore className="w-3 h-3" />
                      Désarchiver
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs gap-1 text-muted-foreground"
                      disabled={archiving[item.id]}
                      onClick={() => handleArchive(item.id)}
                    >
                      <Archive className="w-3 h-3" />
                      Archiver
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Précédent
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount || loading}
              onClick={() => setPage(p => p + 1)}
            >
              Suivant
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
