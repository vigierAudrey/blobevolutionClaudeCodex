"use client";
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Star, StarOff, Trash2, Inbox, Heart, Trash, Mail, Users, Briefcase, Shield, ShieldOff, MessageSquare, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { apiClient } from '../../lib/apiClient';
import type { ThreadSummary, ThreadListQuery } from '@/types/messages';
import { Button } from '../../components/ui/button';
import { ConversationInvitations } from '../../components/ConversationInvitations';
import { ContactRequests } from '../../components/ContactRequests';

// Force SSR for real-time messaging
export const dynamic = 'force-dynamic';

export default function MessagesPage() {
  const [items, setItems] = useState<ThreadSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL'|'FAVORITES'|'UNREAD'|'TRASH'|'RIDERS'|'PROS'>('ALL');
  // Pagination API réelle : stocker le curseur pour la page suivante
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Compteur d'appels API pour debug (non affiché en UI)
  const apiCallCount = useRef(0);

  const load = useCallback(async (softRefresh = false) => {
    try {
      const opts: ThreadListQuery = { includeTrashed: filter === 'TRASH', limit: 100 };
      if (filter === 'RIDERS') opts.type = 'RIDER_TO_RIDER';
      if (filter === 'PROS') opts.type = 'RIDER_TO_PRO';

      apiCallCount.current += 1;
      const page = await apiClient.listConversations(opts);
      console.debug('[Conversations] Loaded', page.items?.length ?? 0, 'items, API calls total:', apiCallCount.current);

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur');
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

      apiCallCount.current += 1;
      const page = await apiClient.listConversations(opts);
      console.debug('[Conversations] Loaded more:', page.items?.length ?? 0, 'items, API calls total:', apiCallCount.current);
      // Append sans duplication (dedup par id)
      setItems(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        const newItems = (page.items ?? []).filter(i => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });
      setNextCursor(page.nextCursor ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur lors du chargement');
    } finally {
      setLoadingMore(false);
    }
  }, [filter, nextCursor, loadingMore]);

  // Reset et rechargement quand le filtre change
  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load();
    // softRefresh=true : le polling ne détruit pas les pages accumulées via "Charger plus"
    const t = setInterval(() => void load(true), 15000);
    return () => clearInterval(t);
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
    <div className="max-w-4xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/dashboard" />

      {/* Page Header */}
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <MessageSquare className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Messagerie</h1>
            <p className="text-sm text-muted-foreground">Organise tes conversations et tes matchs</p>
          </div>
        </div>
        {totalUnread > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-purple-100 dark:bg-purple-900/30 px-3 py-1.5 text-sm font-medium text-purple-700 dark:text-purple-300">
            <Sparkles className="w-3 h-3" />
            {totalUnread} nouveau{totalUnread > 1 ? 'x' : ''}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4 text-red-900">
          <p className="font-medium">{error}</p>
        </div>
      )}

      {/* Invitations en attente */}
      <ConversationInvitations />

      {/* Demandes de contact de pros en attente (rider uniquement) */}
      <ContactRequests />

      {/* Filtres */}
      <Card className="border-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Filtres</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filtres principaux */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={()=>setFilter('ALL')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                filter==='ALL'
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-md'
                  : 'border-2 border-input text-muted-foreground hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <Inbox size={16}/>
              Tous
              {counts.all > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filter==='ALL' ? 'bg-white/20' : 'bg-blue-100 text-blue-700'}`}>{counts.all}</span>}
            </button>

            <button
              onClick={()=>setFilter('UNREAD')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                filter==='UNREAD'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md'
                  : 'border-2 border-input text-muted-foreground hover:border-purple-300 hover:bg-purple-50'
              }`}
            >
              <Mail size={16}/>
              Non lus
              {counts.unread > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filter==='UNREAD' ? 'bg-white/20' : 'bg-purple-100 text-purple-700'}`}>{counts.unread}</span>}
            </button>

            <button
              onClick={()=>setFilter('FAVORITES')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                filter==='FAVORITES'
                  ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md'
                  : 'border-2 border-input text-muted-foreground hover:border-amber-300 hover:bg-amber-50'
              }`}
            >
              <Heart size={16}/>
              Favoris
              {counts.fav > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filter==='FAVORITES' ? 'bg-white/20' : 'bg-amber-100 text-amber-700'}`}>{counts.fav}</span>}
            </button>

            <button
              onClick={()=>setFilter('TRASH')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                filter==='TRASH'
                  ? 'bg-gradient-to-r from-slate-600 to-slate-700 text-white shadow-md'
                  : 'border-2 border-input text-muted-foreground hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Trash size={16}/>
              Corbeille
              {counts.trash > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filter==='TRASH' ? 'bg-white/20' : 'bg-slate-100 text-slate-700'}`}>{counts.trash}</span>}
            </button>
          </div>

          {/* Séparation par type */}
          <div className="pt-3 border-t space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Par type de contact</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={()=>setFilter('RIDERS')}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  filter==='RIDERS'
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md'
                    : 'border-2 border-input text-muted-foreground hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                <Users size={16}/>
                Riders
                {counts.riders > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filter==='RIDERS' ? 'bg-white/20' : 'bg-blue-100 text-blue-700'}`}>{counts.riders}</span>}
              </button>

              <button
                onClick={()=>setFilter('PROS')}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  filter==='PROS'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md'
                    : 'border-2 border-input text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50'
                }`}
              >
                <Briefcase size={16}/>
                Pros
                {counts.pros > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filter==='PROS' ? 'bg-white/20' : 'bg-emerald-100 text-emerald-700'}`}>{counts.pros}</span>}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Liste des conversations */}
      <Card className="border-2">
        {filter === 'TRASH' && counts.trash > 0 && (
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash className="w-5 h-5 text-slate-500" />
                <CardTitle className="text-base">Corbeille ({counts.trash})</CardTitle>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={async ()=>{
                  if (!confirm(`Êtes-vous sûr de vouloir vider la corbeille définitivement ? Cette action est irréversible et supprimera ${counts.trash} conversation${counts.trash > 1 ? 's' : ''}.`)) {
                    return;
                  }
                  try {
                    const result = await apiClient.emptyTrashConversations();
                    await load();
                    alert(`${result.count} conversation${result.count > 1 ? 's ont été supprimées' : ' a été supprimée'} définitivement.`);
                  } catch (err) {
                    alert('Erreur lors de la suppression des conversations');
                  }
                }}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Vider la corbeille
              </Button>
            </div>
          </CardHeader>
        )}
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="rounded-full bg-gradient-to-br from-slate-100 to-slate-200 p-6 mb-4">
                <MessageSquare className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">Aucune conversation</p>
              <p className="text-xs text-muted-foreground">
                {filter === 'TRASH' ? 'La corbeille est vide' : 'Commence à matcher pour démarrer des conversations'}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {visible.map((it) => (
                <div
                  key={it.id}
                  className={`group flex items-center justify-between p-4 transition-all hover:bg-gradient-to-r hover:from-slate-50 hover:to-transparent ${
                    it.unread > 0 ? 'bg-blue-50/30' : ''
                  }`}
                >
                  <Link href={`/messages/${it.id}`} className="flex-1 flex items-start gap-4">
                    {/* Photo de profil */}
                    <div className="relative flex-shrink-0">
                      {it.isGroup ? (
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                          <Users size={28} />
                        </div>
                      ) : it.otherPhotoUrl ? (
                        <div className="relative">
                          <Image
                            src={it.otherPhotoUrl}
                            alt={it.otherDisplayName}
                            width={56}
                            height={56}
                            className={`w-14 h-14 rounded-full object-cover border-3 ${
                              it.otherRole === 'PRO'
                                ? 'border-emerald-300'
                                : 'border-blue-300'
                            }`}
                            unoptimized
                          />
                          {it.unread > 0 && (
                            <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xs font-bold ring-2 ring-white animate-pulse">
                              {it.unread}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${
                          it.otherRole === 'PRO'
                            ? 'from-emerald-400 to-teal-500'
                            : 'from-blue-400 to-indigo-500'
                        } flex items-center justify-center text-white font-bold text-lg shadow-lg`}>
                          {it.otherDisplayName.charAt(0).toUpperCase()}
                        </div>
                      )}

                      {/* Badge rôle ou unread pour groupe */}
                      {it.isGroup ? (
                        it.unread > 0 && (
                          <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xs font-bold ring-2 ring-white animate-pulse">
                            {it.unread}
                          </div>
                        )
                      ) : (
                        <div className={`absolute -bottom-1 -right-1 rounded-full p-1 shadow-md ${
                          it.otherRole === 'PRO'
                            ? 'bg-gradient-to-br from-emerald-500 to-teal-500'
                            : 'bg-gradient-to-br from-blue-500 to-indigo-500'
                        }`}>
                          {it.otherRole === 'PRO' ? (
                            <Briefcase size={12} className="text-white" />
                          ) : (
                            <Users size={12} className="text-white" />
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-base ${it.unread > 0 ? 'font-bold' : 'font-semibold'}`}>
                          {it.otherDisplayName}
                        </span>
                        {it.isGroup && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 px-2 py-0.5 text-xs font-medium">
                            <Users size={10} /> Groupe
                          </span>
                        )}
                        {it.favorite && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 px-2 py-0.5 text-xs font-medium">
                            <Star size={10} className="fill-current"/> Favori
                          </span>
                        )}
                        {it.blocked && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-red-100 to-rose-100 text-red-700 px-2 py-0.5 text-xs font-medium">
                            <Shield size={10}/> Bloqué
                          </span>
                        )}
                        {!it.isGroup && it.otherRole === 'PRO' && (
                          <span className="inline-flex items-center rounded-full bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-700 px-2 py-0.5 text-xs font-medium">
                            PRO
                          </span>
                        )}
                      </div>
                      <p className={`text-sm line-clamp-2 ${
                        it.unread > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'
                      }`}>
                        {it.lastMessage}
                      </p>
                    </div>
                  </Link>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-4">
                    {filter !== 'TRASH' && (
                      <>
                        <button
                          title={it.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                          onClick={async (e)=>{
                            e.preventDefault();
                            await apiClient.favoriteConversation(it.id, !it.favorite);
                            await load();
                          }}
                          className="p-2 rounded-lg hover:bg-amber-100 transition-colors"
                        >
                          {it.favorite ? (
                            <Star className="text-amber-500 fill-current" size={18}/>
                          ) : (
                            <StarOff className="text-slate-400 hover:text-amber-500" size={18}/>
                          )}
                        </button>

                        <button
                          title={it.blocked ? 'Débloquer ce contact' : 'Bloquer ce contact'}
                          onClick={async (e)=>{
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
                          className={`p-2 rounded-lg transition-colors ${
                            it.blocked
                              ? 'text-red-600 hover:bg-red-100'
                              : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                          }`}
                        >
                          {it.blocked ? <ShieldOff size={18}/> : <Shield size={18}/>}
                        </button>

                        <button
                          title="Mettre à la corbeille"
                          onClick={async (e)=>{
                            e.preventDefault();
                            await apiClient.trashConversation(it.id);
                            await load();
                          }}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </>
                    )}

                    {filter === 'TRASH' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async (e)=>{
                          e.preventDefault();
                          await apiClient.untrashConversation(it.id);
                          await load();
                        }}
                      >
                        Restaurer
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charger plus : appel API réel via nextCursor (pas slice mémoire) */}
      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
            className="border-2"
          >
            {loadingMore ? 'Chargement…' : 'Charger plus'}
          </Button>
        </div>
      )}
    </div>
  );
}
