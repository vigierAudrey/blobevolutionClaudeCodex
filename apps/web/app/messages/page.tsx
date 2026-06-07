"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEventHandler, ReactNode } from 'react';
import Link from 'next/link';
import { Star, StarOff, Trash2, Inbox, Heart, Trash, Mail, Users, Briefcase, Shield, ShieldOff, MessageSquare, Sparkles } from 'lucide-react';
import { BackBar } from '../../components/BackBar';
import { apiClient } from '../../lib/apiClient';
import type { ThreadSummary, ThreadListQuery } from '@/types/messages';
import { ConversationInvitations } from '../../components/ConversationInvitations';
import { ContactRequests } from '../../components/ContactRequests';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobDashboardShell, BlobEmptyState } from '@/components/blob';
import { ProfilePhoto } from '@/components/media/ProfilePhoto';

// Force SSR for real-time messaging
export const dynamic = 'force-dynamic';

export default function MessagesPage() {
  const [items, setItems] = useState<ThreadSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL'|'FAVORITES'|'UNREAD'|'TRASH'|'RIDERS'|'PROS'>('ALL');
  // Pagination API réelle : stocker le curseur pour la page suivante
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async (softRefresh = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const opts: ThreadListQuery = { includeTrashed: filter === 'TRASH', limit: 100 };
      if (filter === 'RIDERS') opts.type = 'RIDER_TO_RIDER';
      if (filter === 'PROS') opts.type = 'RIDER_TO_PRO';

      const page = await apiClient.listConversations(opts);
      setError(null);

      if (softRefresh) {
        // Polling : on met à jour les items existants et on préfixe les nouveaux,
        // sans détruire les pages accumulées via "Charger plus".
        setItems(prev => {
          const freshMap = new Map((page.items ?? []).map(i => [i.id, i]));
          const existingIds = new Set(prev.map(i => i.id));
          const newAtTop = (page.items ?? []).filter(i => !existingIds.has(i.id));
          const updated = prev.map(i => freshMap.get(i.id) ?? i);
          return [...newAtTop, ...updated];
        });
        // nextCursor n'est pas réinitialisé : la pagination accumulée est préservée.
      } else {
        setItems(page.items ?? []);
        setNextCursor(page.nextCursor ?? null);
      }
    } catch {
      setError('Impossible de charger les conversations pour le moment.');
    } finally {
      loadingRef.current = false;
    }
  }, [filter]);

  // Charger plus : appel API avec le curseur, append sans doublon
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const opts: ThreadListQuery = { includeTrashed: filter === 'TRASH', limit: 100, cursor: nextCursor };
      if (filter === 'RIDERS') opts.type = 'RIDER_TO_RIDER';
      if (filter === 'PROS') opts.type = 'RIDER_TO_PRO';

      const page = await apiClient.listConversations(opts);
      // Append sans duplication (dedup par id)
      setItems(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        const newItems = (page.items ?? []).filter(i => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });
      setNextCursor(page.nextCursor ?? null);
    } catch {
      setError('Impossible de charger plus de conversations pour le moment.');
    } finally {
      setLoadingMore(false);
    }
  }, [filter, nextCursor, loadingMore]);

  // Reset et rechargement quand le filtre change
  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load();
    let intervalId: number | null = null;

    const startPolling = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      if (intervalId != null) window.clearInterval(intervalId);
      // softRefresh=true : le polling ne détruit pas les pages accumulées via "Charger plus"
      intervalId = window.setInterval(() => void load(true), 15000);
    };
    const stopPolling = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load(true);
        startPolling();
      } else {
        stopPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [filter, load]);

  const counts = useMemo(() => {
    const all = items.filter(it => !it.trashed).length;
    const fav = items.filter(it => !it.trashed && it.favorite).length;
    const unread = items.filter(it => !it.trashed && it.unread > 0).length;
    const trash = items.filter(it => it.trashed).length;
    const riders = items.filter(it => !it.trashed && it.type === 'RIDER_TO_RIDER').length;
    const pros = items.filter(it => !it.trashed && it.type === 'RIDER_TO_PRO').length;
    return { all, fav, unread, trash, riders, pros };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'ALL') return items.filter(i => !i.trashed);
    if (filter === 'FAVORITES') return items.filter(i => !i.trashed && i.favorite);
    if (filter === 'UNREAD') return items.filter(i => !i.trashed && i.unread > 0);
    if (filter === 'RIDERS') return items.filter(i => !i.trashed && i.type === 'RIDER_TO_RIDER');
    if (filter === 'PROS') return items.filter(i => !i.trashed && i.type === 'RIDER_TO_PRO');
    return items.filter(i => i.trashed);
  }, [items, filter]);

  const totalUnread = useMemo(() =>
    items.filter(it => !it.trashed).reduce((acc, it) => acc + it.unread, 0),
    [items]
  );

  return (
    <BlobDashboardShell
      title="Messagerie"
      nav={[
        { label: 'Dashboard', href: '/dashboard', icon: <Inbox size={16} /> },
        { label: 'Messages', href: '/messages', icon: <MessageSquare size={16} /> },
        { label: 'Profil', href: '/profile', icon: <Users size={16} /> },
      ]}
    >
      <div className="mx-auto max-w-4xl space-y-6 pb-8">
        <BackBar fallbackHref="/dashboard" />

        <div className="flex flex-col gap-3 border-b-2 border-blob-sand-deep pb-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-blob-black/72">Organise tes conversations et tes matchs.</p>
          {totalUnread > 0 && (
            <BlobBadge variant="yellow">
              <Sparkles className="h-3 w-3" />
              {totalUnread} nouveau{totalUnread > 1 ? 'x' : ''}
            </BlobBadge>
          )}
        </div>

        {error && <BlobAlert variant="error">{error}</BlobAlert>}

        <ConversationInvitations />
        <ContactRequests />

        <BlobCard className="bg-white">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-blob-black/64" />
              <h2 className="text-xl font-black uppercase tracking-widest">Filtres</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterButton active={filter === 'ALL'} onClick={() => setFilter('ALL')} icon={<Inbox size={16} />} label="Tous" count={counts.all} />
              <FilterButton active={filter === 'UNREAD'} onClick={() => setFilter('UNREAD')} icon={<Mail size={16} />} label="Non lus" count={counts.unread} />
              <FilterButton active={filter === 'FAVORITES'} onClick={() => setFilter('FAVORITES')} icon={<Heart size={16} />} label="Favoris" count={counts.fav} />
              <FilterButton active={filter === 'TRASH'} onClick={() => setFilter('TRASH')} icon={<Trash size={16} />} label="Corbeille" count={counts.trash} />
            </div>
            <div className="space-y-2 border-t-2 border-blob-sand-deep pt-3">
              <p className="text-xs font-black uppercase tracking-widest text-blob-black/56">Par type de contact</p>
              <div className="flex flex-wrap gap-2">
                <FilterButton active={filter === 'RIDERS'} onClick={() => setFilter('RIDERS')} icon={<Users size={16} />} label="Riders" count={counts.riders} />
                <FilterButton active={filter === 'PROS'} onClick={() => setFilter('PROS')} icon={<Briefcase size={16} />} label="Pros" count={counts.pros} />
              </div>
            </div>
          </div>
        </BlobCard>

        {filter === 'TRASH' && counts.trash > 0 && (
          <BlobAlert variant="warning" title={`Corbeille (${counts.trash})`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>Les conversations supprimées peuvent être vidées définitivement.</p>
              <BlobButton
                variant="dark"
                size="sm"
                type="button"
                className="border-red-800 bg-red-700 hover:bg-red-800"
                onClick={async () => {
                  if (!confirm(`Êtes-vous sûr de vouloir vider la corbeille définitivement ? Cette action est irréversible et supprimera ${counts.trash} conversation${counts.trash > 1 ? 's' : ''}.`)) {
                    return;
                  }
                  try {
                    const result = await apiClient.emptyTrashConversations();
                    await load();
                    alert(`${result.count} conversation${result.count > 1 ? 's ont été supprimées' : ' a été supprimée'} définitivement.`);
                  } catch {
                    setError('Impossible de vider la corbeille pour le moment.');
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                Vider la corbeille
              </BlobButton>
            </div>
          </BlobAlert>
        )}

        {visible.length === 0 ? (
          <BlobEmptyState
            title="Aucune conversation"
            description={filter === 'TRASH' ? 'La corbeille est vide.' : 'Commence à matcher pour démarrer des conversations.'}
          />
        ) : (
          <div className="space-y-3">
            {visible.map((it) => (
              <BlobCard key={it.id} className={`bg-white ${it.unread > 0 ? 'border-blob-yellow' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <Link href={`/messages/${it.id}`} className="flex min-w-0 flex-1 items-start gap-4">
                    <div className="relative flex-shrink-0">
                      {it.isGroup ? (
                        <div className="flex h-14 w-14 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-black text-white">
                          <Users size={28} />
                        </div>
                      ) : it.otherPhotoUrl ? (
                        <ProfilePhoto
                          src={it.otherPhotoUrl}
                          alt={it.otherDisplayName}
                          width={56}
                          height={56}
                          className="h-14 w-14 rounded-sm border-2 border-blob-black object-cover"
                          fallbackClassName="flex h-14 w-14 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-sand px-1 text-center text-[10px] font-medium text-blob-black/60"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-sand text-lg font-black">
                          {it.otherDisplayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      {it.unread > 0 && (
                        <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-sm border-2 border-white bg-blob-yellow px-1 text-[10px] font-black text-blob-black">
                          {it.unread}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className={`text-base ${it.unread > 0 ? 'font-black' : 'font-bold'}`}>
                          {it.otherDisplayName}
                        </span>
                        {it.isGroup && <BlobBadge variant="dark"><Users size={10} /> Groupe</BlobBadge>}
                        {it.favorite && <BlobBadge variant="yellow"><Star size={10} className="fill-current" /> Favori</BlobBadge>}
                        {it.blocked && <BlobBadge variant="error"><Shield size={10} /> Bloqué</BlobBadge>}
                        {!it.isGroup && it.otherRole === 'PRO' && <BlobBadge variant="success">PRO</BlobBadge>}
                      </div>
                      <p className={`line-clamp-2 text-sm ${it.unread > 0 ? 'font-medium text-blob-black' : 'text-blob-black/64'}`}>
                        {it.lastMessage}
                      </p>
                    </div>
                  </Link>

                  <div className="ml-1 flex flex-shrink-0 flex-col gap-2 sm:flex-row">
                    {filter !== 'TRASH' ? (
                      <>
                        <IconAction
                          title={it.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                          onClick={async (e) => {
                            e.preventDefault();
                            try {
                              await apiClient.favoriteConversation(it.id, !it.favorite);
                              await load();
                            } catch {
                              setError('Impossible de mettre à jour cette conversation.');
                            }
                          }}
                        >
                          {it.favorite ? <Star className="fill-current" size={18} /> : <StarOff size={18} />}
                        </IconAction>
                        <IconAction
                          title={it.blocked ? 'Débloquer ce contact' : 'Bloquer ce contact'}
                          danger
                          onClick={async (e) => {
                            e.preventDefault();
                            try {
                              if (it.blocked) {
                                await apiClient.unblockConversation(it.id);
                              } else if (confirm('Êtes-vous sûr de vouloir bloquer ce contact ? Il ne pourra plus vous envoyer de messages.')) {
                                await apiClient.blockConversation(it.id);
                              }
                              await load();
                            } catch {
                              setError('Impossible de mettre à jour cette conversation.');
                            }
                          }}
                        >
                          {it.blocked ? <ShieldOff size={18} /> : <Shield size={18} />}
                        </IconAction>
                        <IconAction
                          title="Mettre à la corbeille"
                          danger
                          onClick={async (e) => {
                            e.preventDefault();
                            try {
                              await apiClient.trashConversation(it.id);
                              await load();
                            } catch {
                              setError('Impossible de mettre cette conversation à la corbeille.');
                            }
                          }}
                        >
                          <Trash2 size={18} />
                        </IconAction>
                      </>
                    ) : (
                      <BlobButton
                        size="sm"
                        variant="outlineDark"
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            await apiClient.untrashConversation(it.id);
                            await load();
                          } catch {
                            setError('Impossible de restaurer cette conversation.');
                          }
                        }}
                      >
                        Restaurer
                      </BlobButton>
                    )}
                  </div>
                </div>
              </BlobCard>
            ))}
          </div>
        )}

        {nextCursor && (
          <div className="flex justify-center">
            <BlobButton
              variant="outlineDark"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Chargement...' : 'Charger plus'}
            </BlobButton>
          </div>
        )}
      </div>
    </BlobDashboardShell>
  );
}

function FilterButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-2 rounded-sm border-2 px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow ${
        active
          ? 'border-blob-black bg-blob-black text-white'
          : 'border-blob-black bg-white text-blob-black hover:bg-blob-sand'
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${active ? 'border-white/30' : 'border-blob-black/20 bg-blob-sand'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function IconAction({
  title,
  children,
  onClick,
  danger = false,
}: {
  title: string;
  children: ReactNode;
  onClick: MouseEventHandler<HTMLButtonElement>;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-sm border-2 border-blob-black bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow ${
        danger ? 'text-red-800 hover:bg-red-50' : 'text-blob-black hover:bg-blob-sand'
      }`}
    >
      {children}
    </button>
  );
}
