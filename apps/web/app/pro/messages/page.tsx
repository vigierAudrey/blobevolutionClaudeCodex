"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, StarOff, Trash2, Inbox, Heart, Trash, Mail, Users, ArrowLeft, Briefcase, Shield, ShieldOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { apiClient } from '../../../lib/apiClient';
import type { ThreadSummary, ThreadListQuery } from '@/types/messages';
import { requireClientRole, RoleMismatchError, SessionRequiredError } from '../../../lib/clientSession';
import { ProfilePhoto } from '../../../components/media/ProfilePhoto';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobEmptyState, BlobMark } from '@/components/blob';

type FilterValue = 'ALL' | 'FAVORITES' | 'UNREAD' | 'TRASH' | 'RIDERS';

const filterButtonClass = (active: boolean) =>
  [
    'inline-flex min-h-10 items-center gap-1.5 rounded-sm border-2 px-3 py-2 text-xs font-black uppercase tracking-widest transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2',
    active
      ? 'border-blob-black bg-blob-yellow text-blob-black'
      : 'border-blob-black/30 bg-white text-blob-black/70 hover:border-blob-black hover:text-blob-black dark:border-white/25 dark:bg-white/10 dark:text-white/70 dark:hover:border-white dark:hover:text-white',
  ].join(' ');

export default function ProMessagesPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [items, setItems] = useState<ThreadSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [loading, setLoading] = useState(true);
  // Pagination API réelle
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const apiCallCount = useRef(0);

  // Vérification auth et rôle PRO
  useEffect(() => {
    const checkAuth = async () => {
      try {
        await requireClientRole('PRO');
        setAuthorized(true);
      } catch (err) {
        if (err instanceof RoleMismatchError) {
          router.replace('/dashboard');
          return;
        }
        if (err instanceof SessionRequiredError) {
          router.replace('/login');
          return;
        }
        console.error('Auth check failed:', err);
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  const load = useCallback(async (softRefresh = false) => {
    try {
      const opts: ThreadListQuery = { includeTrashed: filter === 'TRASH', limit: 100 };
      if (filter === 'RIDERS') opts.type = 'RIDER_TO_PRO';

      apiCallCount.current += 1;
      const page = await apiClient.listConversations(opts);
      console.debug('[ProConversations] Loaded', page.items?.length ?? 0, 'items, API calls total:', apiCallCount.current);
      const freshItems = (page.items ?? []).filter((conv: ThreadSummary) => conv.type !== 'PRO_TO_PRO');

      if (softRefresh) {
        // Polling : merge sans détruire les pages accumulées via "Charger plus".
        setItems(prev => {
          const freshMap = new Map(freshItems.map(i => [i.id, i]));
          const existingIds = new Set(prev.map(i => i.id));
          const newAtTop = freshItems.filter(i => !existingIds.has(i.id));
          const updated = prev.map(i => freshMap.get(i.id) ?? i);
          return [...newAtTop, ...updated];
        });
        // nextCursor non réinitialisé : pagination accumulée préservée.
      } else {
        setItems(freshItems);
        setNextCursor(page.nextCursor ?? null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors du chargement des conversations');
    }
  }, [filter]);

  // Charger plus : appel API avec curseur, append sans doublon
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const opts: ThreadListQuery = { includeTrashed: filter === 'TRASH', limit: 100, cursor: nextCursor };
      if (filter === 'RIDERS') opts.type = 'RIDER_TO_PRO';

      apiCallCount.current += 1;
      const page = await apiClient.listConversations(opts);
      console.debug('[ProConversations] Loaded more:', page.items?.length ?? 0, 'API calls total:', apiCallCount.current);
      const newRiderThreads = (page.items ?? []).filter((conv: ThreadSummary) => conv.type !== 'PRO_TO_PRO');
      setItems(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        return [...prev, ...newRiderThreads.filter(i => !existingIds.has(i.id))];
      });
      setNextCursor(page.nextCursor ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors du chargement');
    } finally {
      setLoadingMore(false);
    }
  }, [filter, nextCursor, loadingMore]);

  useEffect(() => {
    if (!authorized) return;
    setItems([]);
    setNextCursor(null);
    void load();
    // softRefresh=true : le polling ne détruit pas les pages accumulées via "Charger plus"
    const interval = setInterval(() => void load(true), 15000);
    return () => clearInterval(interval);
  }, [authorized, load]);

  const counts = useMemo(() => {
    const all = items.filter(it => !it.trashed).length;
    const fav = items.filter(it => !it.trashed && it.favorite).length;
    const unread = items.filter(it => !it.trashed && it.unread > 0).length;
    const trash = items.filter(it => it.trashed).length;
    const riders = items.filter(it => !it.trashed && it.type === 'RIDER_TO_PRO').length;
    return { all, fav, unread, trash, riders };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'ALL') return items.filter(i => !i.trashed);
    if (filter === 'FAVORITES') return items.filter(i => !i.trashed && i.favorite);
    if (filter === 'UNREAD') return items.filter(i => !i.trashed && i.unread > 0);
    if (filter === 'RIDERS') return items.filter(i => !i.trashed && i.type === 'RIDER_TO_PRO');
    return items.filter(i => i.trashed);
  }, [items, filter]);

  if (loading) return (
    <div className="mx-auto max-w-2xl space-y-4 pt-8">
      <BlobAlert title="Chargement">Chargement…</BlobAlert>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      {/* Header avec retour */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <BlobButton asChild variant="outlineDark" size="sm" className="w-full sm:w-auto">
          <Link href="/pro/dashboard">
            <ArrowLeft size={16} aria-hidden />
            Dashboard
          </Link>
        </BlobButton>
        <BlobCard mode="yellowSignal" className="flex-1 motion-safe:hover:translate-y-0">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
              <BlobMark size={26} decorative />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-black uppercase tracking-widest text-blob-black">Mes conversations</h1>
                <BlobBadge variant="dark">Pro</BlobBadge>
              </div>
              <p className="mt-2 text-sm leading-6 text-blob-black/72">Messages avec tes élèves potentiels.</p>
            </div>
          </div>
        </BlobCard>
      </div>

      <Card className="overflow-hidden rounded-sm border-2 border-blob-sand-deep bg-white text-blob-black dark:border-white/10 dark:bg-[hsl(220_14%_14%)] dark:text-white">
        <CardHeader className="border-b-2 border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5">
          <CardTitle className="flex items-center gap-2 text-xl font-black uppercase tracking-widest text-blob-black dark:text-white">
            <Users size={20} />
            Conversations
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {error && (
            <div className="mb-4">
              <BlobAlert variant="error" title="Erreur">
                {error}
              </BlobAlert>
            </div>
          )}

          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button onClick={() => setFilter('ALL')} className={filterButtonClass(filter === 'ALL')}>
                <Inbox size={14} aria-hidden /> Tous {counts.all > 0 ? `(${counts.all})` : ''}
              </button>
              <button onClick={() => setFilter('FAVORITES')} className={filterButtonClass(filter === 'FAVORITES')}>
                <Heart size={14} aria-hidden /> Favoris {counts.fav > 0 ? `(${counts.fav})` : ''}
              </button>
              <button onClick={() => setFilter('UNREAD')} className={filterButtonClass(filter === 'UNREAD')}>
                <Mail size={14} aria-hidden /> Non lus {counts.unread > 0 ? `(${counts.unread})` : ''}
              </button>
              <button onClick={() => setFilter('TRASH')} className={filterButtonClass(filter === 'TRASH')}>
                <Trash size={14} aria-hidden /> Corbeille {counts.trash > 0 ? `(${counts.trash})` : ''}
              </button>
            </div>

            {/* Séparation par type de conversation */}
            <div className="flex flex-wrap items-center gap-2 border-t-2 border-blob-sand-deep pt-3 text-xs dark:border-white/10">
              <span className="text-[10px] font-black uppercase tracking-widest text-blob-black/55 dark:text-white/50">Par type :</span>
              <button onClick={() => setFilter('RIDERS')} className={filterButtonClass(filter === 'RIDERS')}>
                <Users size={14} aria-hidden /> Élèves {counts.riders > 0 ? `(${counts.riders})` : ''}
              </button>
            </div>
          </div>

          {visible.length === 0 && (
            <BlobEmptyState
              title={
                filter === 'ALL'
                  ? 'Aucune conversation pour le moment.'
                  : filter === 'RIDERS'
                    ? 'Aucune conversation avec des élèves.'
                    : 'Aucune conversation dans cette catégorie.'
              }
              description={filter === 'ALL' || filter === 'RIDERS' ? 'Les riders vous contacteront via la BloboMap.' : undefined}
            />
          )}

          <div className="divide-y-2 divide-blob-sand-deep dark:divide-white/10">
            {visible.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 px-2 py-3 transition-colors hover:bg-blob-sand dark:hover:bg-white/5">
                <Link href={`/messages/${it.id}`} className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="relative shrink-0">
                    {it.otherPhotoUrl ? (
                      <ProfilePhoto
                        src={it.otherPhotoUrl}
                        alt={it.otherDisplayName}
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-sm border-2 border-blob-black object-cover"
                        fallbackClassName="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-sand px-1 text-center text-[8px] text-blob-black/60"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-sm font-black text-blob-black">
                        {it.otherDisplayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 rounded-sm border border-blob-black bg-white p-0.5 dark:bg-[hsl(220_14%_14%)]">
                      {it.otherRole === 'PRO' ? (
                        <Briefcase size={14} className="text-blob-black dark:text-white" />
                      ) : (
                        <Users size={14} className="text-blob-black dark:text-white" />
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className={(it.unread > 0 ? 'font-black' : 'font-medium') + " flex items-center gap-2 flex-wrap text-sm text-blob-black dark:text-white"}>
                      {it.otherDisplayName}
                      {it.favorite && <span className="inline-flex items-center gap-1 rounded-sm border border-blob-yellow bg-blob-yellow px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-blob-black"><Star size={10}/> Favori</span>}
                      {it.blocked && <span className="inline-flex items-center gap-1 rounded-sm border border-blob-black bg-blob-black px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white"><Shield size={10}/> Bloqué</span>}
                      <span className="inline-flex items-center rounded-sm border border-blob-sand-deep bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-blob-black dark:border-white/20 dark:bg-white/10 dark:text-white">
                        {it.otherRole === 'PRO' ? 'PRO' : 'ÉLÈVE'}
                      </span>
                    </div>
                    <div className={(it.unread > 0 ? 'text-blob-black dark:text-white' : 'text-blob-black/60 dark:text-white/55') + " line-clamp-1 text-xs"}>{it.lastMessage}</div>
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {filter !== 'TRASH' && (
                    <button
                      title={it.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                      onClick={async (e) => {
                        e.preventDefault();
                        await apiClient.favoriteConversation(it.id, !it.favorite);
                        await load();
                      }}
                      className="rounded-sm border-2 border-transparent p-1 text-blob-black/60 transition-colors hover:border-blob-yellow hover:text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:text-white/60 dark:hover:text-white"
                    >
                      {it.favorite ? <Star className="text-amber-500" size={16}/> : <StarOff size={16}/>}
                    </button>
                  )}
                  {filter !== 'TRASH' && (
                    <button
                      title={it.blocked ? 'Débloquer ce contact' : 'Bloquer ce contact'}
                      onClick={async (e) => {
                        e.preventDefault();
                        if (it.blocked) {
                          await apiClient.unblockConversation(it.id);
                        } else {
                          if (confirm('Êtes-vous sûr de vouloir bloquer ce contact ? Il ne pourra plus vous envoyer de messages.')) {
                            await apiClient.blockConversation(it.id);
                          }
                        }
                        await load();
                      }}
                      className="rounded-sm border-2 border-transparent p-1 text-blob-black/60 transition-colors hover:border-blob-yellow hover:text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:text-white/60 dark:hover:text-white"
                    >
                      {it.blocked ? <ShieldOff size={16}/> : <Shield size={16}/>}
                    </button>
                  )}
                  {filter !== 'TRASH' ? (
                    <button
                      title="Mettre à la corbeille"
                      onClick={async (e) => {
                        e.preventDefault();
                        await apiClient.trashConversation(it.id);
                        await load();
                      }}
                      className="rounded-sm border-2 border-transparent p-1 text-blob-black/60 transition-colors hover:border-blob-yellow hover:text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:text-white/60 dark:hover:text-white"
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : (
                    <button
                      title="Restaurer"
                      onClick={async (e) => {
                        e.preventDefault();
                        await apiClient.untrashConversation(it.id);
                        await load();
                      }}
                      className="rounded-sm border-2 border-blob-black px-3 py-1 text-xs font-black uppercase tracking-widest text-blob-black hover:bg-blob-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:border-white/70 dark:text-white dark:hover:bg-white/10"
                    >
                      Restaurer
                    </button>
                  )}
                  {it.unread > 0 && <span className="inline-block rounded-sm border border-blob-black bg-blob-yellow px-2 py-0.5 text-xs font-black text-blob-black">{it.unread}</span>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Charger plus : appel API réel via nextCursor */}
      {nextCursor && (
        <div className="flex justify-center">
          <button
            className="rounded-sm border-2 border-blob-black px-4 py-2 text-sm font-black uppercase tracking-widest text-blob-black transition-colors hover:bg-blob-sand disabled:opacity-50 dark:border-white/70 dark:text-white dark:hover:bg-white/10"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      )}
    </div>
  );
}
