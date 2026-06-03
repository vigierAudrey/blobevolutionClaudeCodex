"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, StarOff, Trash2, Inbox, Heart, Trash, Mail, Users, ArrowLeft, Briefcase, Shield, ShieldOff, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import type { ThreadSummary, ThreadListQuery } from '@/types/messages';
import { requireClientRole, RoleMismatchError, SessionRequiredError } from '../../../lib/clientSession';

export default function ProMessagesPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [items, setItems] = useState<ThreadSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL'|'FAVORITES'|'UNREAD'|'TRASH'|'RIDERS'>('ALL');
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
    <div className="max-w-2xl mx-auto space-y-4 pt-8">
      <p className="text-center text-muted-foreground">Chargement…</p>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      {/* Header avec retour */}
      <div className="flex items-center gap-4">
        <Link href="/pro/dashboard">
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            <ArrowLeft size={16} />
            Dashboard
          </Button>
        </Link>
        <div className="flex items-center gap-4 flex-1 rounded-2xl bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20 p-4 border-2 border-purple-200/50 dark:border-purple-800/50">
          <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Mes Conversations 💬</h1>
            <p className="text-sm text-muted-foreground">Messages avec tes élèves potentiels</p>
          </div>
        </div>
      </div>

      <Card className="border-2 rounded-[1.75rem]">
        <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Users size={20} />
            Conversations
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <button onClick={() => setFilter('ALL')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter === 'ALL' ? 'border-primary text-primary' : 'border-input text-muted-foreground'}`}>
                <Inbox size={14}/> Tous {counts.all > 0 ? `(${counts.all})` : ''}
              </button>
              <button onClick={() => setFilter('FAVORITES')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter === 'FAVORITES' ? 'border-primary text-primary' : 'border-input text-muted-foreground'}`}>
                <Heart size={14}/> Favoris {counts.fav > 0 ? `(${counts.fav})` : ''}
              </button>
              <button onClick={() => setFilter('UNREAD')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter === 'UNREAD' ? 'border-primary text-primary' : 'border-input text-muted-foreground'}`}>
                <Mail size={14}/> Non lus {counts.unread > 0 ? `(${counts.unread})` : ''}
              </button>
              <button onClick={() => setFilter('TRASH')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter === 'TRASH' ? 'border-primary text-primary' : 'border-input text-muted-foreground'}`}>
                <Trash size={14}/> Corbeille {counts.trash > 0 ? `(${counts.trash})` : ''}
              </button>
            </div>

            {/* Séparation par type de conversation */}
            <div className="flex items-center gap-2 text-xs border-t pt-3">
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">Par type :</span>
              <button onClick={() => setFilter('RIDERS')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter === 'RIDERS' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-input text-muted-foreground'}`}>
                <Users size={14}/> Élèves {counts.riders > 0 ? `(${counts.riders})` : ''}
              </button>
            </div>
          </div>

          {visible.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {filter === 'ALL' ? (
                <div>
                  <p>Aucune conversation pour le moment.</p>
                  <p className="text-sm mt-2">
                    Les riders vous contacteront via la BloboMap.
                  </p>
                </div>
              ) : filter === 'RIDERS' ? (
                <div>
                  <p>Aucune conversation avec des élèves.</p>
                  <p className="text-sm mt-2">Les riders vous contacteront via la BloboMap.</p>
                </div>
              ) : (
                <p>Aucune conversation dans cette catégorie.</p>
              )}
            </div>
          )}

          <div className="divide-y">
            {visible.map((it) => (
              <div key={it.id} className="flex items-center justify-between py-3 rounded-md px-2 hover:bg-accent">
                <Link href={`/messages/${it.id}`} className="flex-1 flex items-start gap-3">
                  <div className="relative flex-shrink-0">
                    {it.otherPhotoUrl ? (
                      <Image
                        src={it.otherPhotoUrl}
                        alt={it.otherDisplayName}
                        width={40}
                        height={40}
                        className="w-10 h-10 rounded-full object-cover border-2 border-gray-200"
                        unoptimized
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                        {it.otherDisplayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5">
                      {it.otherRole === 'PRO' ? (
                        <Briefcase size={14} className="text-green-600" />
                      ) : (
                        <Users size={14} className="text-blue-600" />
                      )}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={(it.unread > 0 ? 'font-semibold' : 'font-medium') + " flex items-center gap-2 flex-wrap"}>
                      {it.otherDisplayName}
                      {it.favorite && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px]"><Star size={10}/> Favori</span>}
                      {it.blocked && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px]"><Shield size={10}/> Bloqué</span>}
                      <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px]">
                        {it.otherRole === 'PRO' ? 'PRO' : 'ÉLÈVE'}
                      </span>
                    </div>
                    <div className={(it.unread > 0 ? 'text-foreground' : 'text-muted-foreground') + " text-xs line-clamp-1"}>{it.lastMessage}</div>
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  {filter !== 'TRASH' && (
                    <button
                      title={it.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                      onClick={async (e) => {
                        e.preventDefault();
                        await apiClient.favoriteConversation(it.id, !it.favorite);
                        await load();
                      }}
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
                      className={it.blocked ? 'text-red-600' : 'text-gray-500 hover:text-red-600'}
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
                    >
                      Restaurer
                    </button>
                  )}
                  {it.unread > 0 && <span className="inline-block rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5">{it.unread}</span>}
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
            className="text-sm underline disabled:opacity-50"
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
