"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { optimizedApiClient } from '../../../lib/optimizedApiClient';
import Link from 'next/link';
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Inbox, MessageSquare } from 'lucide-react';
import { BackBar } from '../../../components/BackBar';
import { BlobBadge, BlobButton, BlobCard, BlobEmptyState, BlobMark } from '@/components/blob';

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

const STATUS_VARIANT: Record<ContactRequestItem['status'], 'yellow' | 'success' | 'error'> = {
  PENDING:  'yellow',
  ACCEPTED: 'success',
  REJECTED: 'error',
};

const PAGE_SIZE = 20;

const tabButtonClass = (active: boolean) =>
  [
    'min-h-11 rounded-sm border-2 px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors',
    active
      ? 'border-blob-black bg-blob-yellow text-blob-black'
      : 'border-blob-black/20 bg-white text-blob-black/70 hover:border-blob-yellow hover:text-blob-black dark:border-white/20 dark:bg-white/5 dark:text-white/70 dark:hover:text-white',
  ].join(' ');

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
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-8">
      <BackBar fallbackHref="/pro/dashboard" tone="blobDark" />

      <BlobCard mode="yellowSignal">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
            <BlobMark size={26} decorative />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-black uppercase tracking-widest text-blob-black">Demandes de contact</h1>
              <BlobBadge variant="dark">Pro</BlobBadge>
            </div>
            <p className="mt-2 text-sm leading-6 text-blob-black/72">
              {total} demande{total !== 1 ? 's' : ''} {filter === 'active' ? 'actives' : filter === 'archived' ? 'archivées' : 'au total'}
            </p>
          </div>
        </div>
      </BlobCard>

      <div className="flex flex-wrap gap-2 border-b-2 border-blob-sand-deep pb-3 dark:border-white/10">
        {tabs.map(tab => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleFilterChange(tab.value)}
            className={tabButtonClass(filter === tab.value)}
          >
            {tab.label}
            {typeof tab.count === 'number' ? ` (${tab.count})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-label="Chargement des demandes">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-sm border-2 border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <BlobEmptyState
          title={`Aucune demande ${filter === 'archived' ? 'archivée' : 'active'}`}
          description="Les nouvelles demandes visibles depuis la BloboMap apparaîtront ici."
          action={<Inbox className="h-5 w-5 text-blob-black/50 dark:text-white/60" />}
        />
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <BlobCard key={item.id} mode="white" className="motion-safe:hover:translate-y-0">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-base font-black uppercase tracking-wide text-blob-black dark:text-white">{item.riderName}</h2>
                    <BlobBadge variant={STATUS_VARIANT[item.status]}>{STATUS_LABEL[item.status]}</BlobBadge>
                  </div>
                  <p className="text-xs font-bold uppercase tracking-widest text-blob-black/50 dark:text-white/50">
                    {new Date(item.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  {item.message && (
                    <p className="line-clamp-2 text-sm leading-6 text-blob-black/68 dark:text-white/64">{item.message}</p>
                  )}
                </div>
                <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                  <BlobButton asChild variant="outlineDark" size="sm">
                    <Link href={`/pro/messages?conversationId=${item.conversationId}`}>
                      <MessageSquare className="h-4 w-4" />
                      Conversation
                    </Link>
                  </BlobButton>
                  {item.archivedByPro ? (
                    <BlobButton
                      variant="outlineDark"
                      size="sm"
                      disabled={archiving[item.id]}
                      onClick={() => handleUnarchive(item.id)}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      Désarchiver
                    </BlobButton>
                  ) : (
                    <BlobButton
                      variant="outlineDark"
                      size="sm"
                      disabled={archiving[item.id]}
                      onClick={() => handleArchive(item.id)}
                    >
                      <Archive className="h-4 w-4" />
                      Archiver
                    </BlobButton>
                  )}
                </div>
              </div>
            </BlobCard>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex flex-col items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <BlobButton
            variant="outlineDark"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Précédent
          </BlobButton>
          <span className="text-center text-sm font-bold text-blob-black/64 dark:text-white/60">
            Page {page} / {pageCount}
          </span>
          <BlobButton
            variant="outlineDark"
            size="sm"
            disabled={page >= pageCount || loading}
            onClick={() => setPage(p => p + 1)}
          >
            Suivant
            <ChevronRight className="h-4 w-4" />
          </BlobButton>
        </div>
      )}
    </div>
  );
}
