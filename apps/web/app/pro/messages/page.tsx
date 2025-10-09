"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, StarOff, Trash2, Inbox, Heart, Trash, Mail, Users, ArrowLeft, Briefcase, Network, Shield, ShieldOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';

type ConversationItem = {
  id: string;
  type: 'RIDER_TO_RIDER' | 'RIDER_TO_PRO' | 'PRO_TO_PRO';
  otherDisplayName: string;
  otherRole: 'RIDER' | 'PRO';
  lastMessage: string;
  lastAt: string;
  unread: number;
  trashed?: boolean;
  favorite?: boolean;
  blocked?: boolean;
};

export default function ProMessagesPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL'|'FAVORITES'|'UNREAD'|'TRASH'|'RIDERS'|'PROS'>('ALL');
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

        setUser(currentUser);
      } catch (err) {
        console.error('Auth check failed:', err);
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  const load = async () => {
    try {
      const opts: { includeTrashed?: boolean; type?: 'RIDER_TO_RIDER' | 'RIDER_TO_PRO' | 'PRO_TO_PRO' } = {
        includeTrashed: filter === 'TRASH'
      };

      // Filtrer par type selon le filtre sélectionné
      if (filter === 'RIDERS') opts.type = 'RIDER_TO_PRO';
      if (filter === 'PROS') opts.type = 'PRO_TO_PRO';

      const data = await apiClient.listConversations(opts);
      setItems(data.items || []);
    } catch (e: any) {
      setError(e?.message || 'Erreur lors du chargement des conversations');
    }
  };

  useEffect(() => {
    if (user) {
      load();
      const t = setInterval(load, 15000);
      return () => clearInterval(t);
    }
  }, [filter, user]);

  const counts = useMemo(() => {
    const all = items.filter(it => !it.trashed).length;
    const fav = items.filter(it => !it.trashed && it.favorite).length;
    const unread = items.filter(it => !it.trashed && it.unread > 0).length;
    const trash = items.filter(it => it.trashed).length;
    const riders = items.filter(it => !it.trashed && it.type === 'RIDER_TO_PRO').length;
    const pros = items.filter(it => !it.trashed && it.type === 'PRO_TO_PRO').length;
    return { all, fav, unread, trash, riders, pros };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'ALL') return items.filter(i => !i.trashed);
    if (filter === 'FAVORITES') return items.filter(i => !i.trashed && i.favorite);
    if (filter === 'UNREAD') return items.filter(i => !i.trashed && i.unread > 0);
    if (filter === 'RIDERS') return items.filter(i => !i.trashed && i.type === 'RIDER_TO_PRO');
    if (filter === 'PROS') return items.filter(i => !i.trashed && i.type === 'PRO_TO_PRO');
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
              <button onClick={() => setFilter('PROS')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter === 'PROS' ? 'border-green-500 text-green-600 bg-green-50' : 'border-input text-muted-foreground'}`}>
                <Briefcase size={14}/> Autres Pros {counts.pros > 0 ? `(${counts.pros})` : ''}
              </button>
            </div>
          </div>

          {visible.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {filter === 'ALL' ? (
                <div>
                  <p>Aucune conversation pour le moment.</p>
                  <p className="text-sm mt-2">
                    Les riders vous contacteront via votre offre de cours, et vous pouvez échanger avec d'autres professionnels.
                  </p>
                </div>
              ) : filter === 'RIDERS' ? (
                <div>
                  <p>Aucune conversation avec des élèves.</p>
                  <p className="text-sm mt-2">Les riders vous contacteront via votre offre de cours ou la BloboMap.</p>
                </div>
              ) : filter === 'PROS' ? (
                <div>
                  <p>Aucune conversation avec d'autres pros.</p>
                  <p className="text-sm mt-2">Découvrez d'autres professionnels dans le réseau.</p>
                  <Link href="/pro/network" className="inline-block mt-3">
                    <Button variant="outline" size="sm" className="flex items-center gap-2">
                      <Network size={16} />
                      Explorer le réseau pro
                    </Button>
                  </Link>
                </div>
              ) : (
                <p>Aucune conversation dans cette catégorie.</p>
              )}
            </div>
          )}

          <div className="divide-y">
            {shown.map((it) => (
              <div key={it.id} className="flex items-center justify-between py-3 rounded-md px-2 hover:bg-accent">
                <Link href={`/messages/${it.id}`} className="flex-1">
                  <div>
                    <div className={(it.unread > 0 ? 'font-semibold' : 'font-medium') + " flex items-center gap-2"}>
                      {it.otherRole === 'PRO' && <Briefcase size={12} className="text-green-600" />}
                      {it.otherRole === 'RIDER' && <Users size={12} className="text-blue-600" />}
                      {it.otherDisplayName}
                      {it.favorite && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px]"><Star size={10}/> Favori</span>}
                      {it.blocked && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px]"><Shield size={10}/> Bloqué</span>}
                      {it.otherRole === 'PRO' && <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px]">PRO</span>}
                      {it.otherRole === 'RIDER' && <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px]">ÉLÈVE</span>}
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