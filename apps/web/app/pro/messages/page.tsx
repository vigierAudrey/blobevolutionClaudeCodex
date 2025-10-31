"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, StarOff, Trash2, Inbox, Heart, Trash, Mail, Users, ArrowLeft, Briefcase, Shield, ShieldOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import type { ThreadSummary, ThreadListQuery, ThreadListResponse } from '@/types/messages';

export default function ProMessagesPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [items, setItems] = useState<ThreadSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL'|'FAVORITES'|'UNREAD'|'TRASH'|'RIDERS'>('ALL');
  const [loading, setLoading] = useState(true);

  // Vérification auth et rôle PRO
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = await apiClient.me();
        if (currentUser.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }
        setAuthorized(true);
      } catch (err) {
        console.error('Auth check failed:', err);
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);
  const load = useCallback(async () => {
    try {
      const opts: ThreadListQuery = { includeTrashed: filter === 'TRASH' };
      if (filter === 'RIDERS') opts.type = 'RIDER_TO_PRO';

      const data = (await apiClient.listConversations(opts)) as ThreadListResponse;
      const onlyRiderThreads = (data.items ?? []).filter((conv) => conv.type !== 'PRO_TO_PRO');
      setItems(onlyRiderThreads);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors du chargement des conversations');
    }
  }, [filter]);

  useEffect(() => {
    if (!authorized) return;
    void load();
    const interval = setInterval(load, 15000);
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

  // Client-side lazy load
  const PAGE = 20;
  const [limit, setLimit] = useState<number>(PAGE);
  useEffect(() => { setLimit(PAGE); }, [filter]);
  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);

  if (loading) return <p>Chargement…</p>;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header avec retour */}
      <div className="flex items-center gap-4">
        <Link href="/pro/dashboard">
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            <ArrowLeft size={16} />
            Dashboard
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Mes Conversations</h1>
          <p className="text-sm text-muted-foreground">
            Messages avec vos élèves potentiels
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users size={20} />
            Mes Conversations
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                    Les riders vous contacteront via votre offre de cours.
                  </p>
                </div>
              ) : filter === 'RIDERS' ? (
                <div>
                  <p>Aucune conversation avec des élèves.</p>
                  <p className="text-sm mt-2">Les riders vous contacteront via votre offre de cours ou la BloboMap.</p>
                </div>
              ) : (
                <p>Aucune conversation dans cette catégorie.</p>
              )}
            </div>
          )}

          <div className="divide-y">
            {shown.map((it) => (
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

      {shown.length < visible.length && (
        <div className="flex justify-center">
          <button className="text-sm underline" onClick={() => setLimit((n) => n + PAGE)}>Charger plus</button>
        </div>
      )}
    </div>
  );
}
