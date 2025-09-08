"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Star, StarOff, Trash2, Inbox, Heart, Trash, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { apiClient } from '../../lib/apiClient';

export default function MessagesPage() {
  const [items, setItems] = useState<Array<{ id: string; otherDisplayName: string; lastMessage: string; lastAt: string; unread: number; trashed?: boolean; favorite?: boolean }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL'|'FAVORITES'|'UNREAD'|'TRASH'>('ALL');

  const load = async () => {
    try {
      const data = await apiClient.listConversations({ includeTrashed: filter === 'TRASH' });
      setItems(data.items || []);
    } catch (e: any) { setError(e?.message || 'Erreur'); }
  };

  useEffect(() => { load(); const t=setInterval(load, 15000); return ()=>clearInterval(t); }, [filter]);

  const counts = useMemo(() => {
    const all = items.filter(it => !it.trashed).length;
    const fav = items.filter(it => !it.trashed && it.favorite).length;
    const unread = items.filter(it => !it.trashed && it.unread > 0).length;
    const trash = items.filter(it => it.trashed).length;
    return { all, fav, unread, trash };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'ALL') return items.filter(i => !i.trashed);
    if (filter === 'FAVORITES') return items.filter(i => !i.trashed && i.favorite);
    if (filter === 'UNREAD') return items.filter(i => !i.trashed && i.unread > 0);
    return items.filter(i => i.trashed);
  }, [items, filter]);

  // Client-side lazy load
  const PAGE = 20;
  const [limit, setLimit] = useState<number>(PAGE);
  useEffect(()=>{ setLimit(PAGE); }, [filter]);
  const shown = useMemo(()=>visible.slice(0, limit), [visible, limit]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>Mes conversations</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="mb-3 flex items-center gap-2 text-xs">
            <button onClick={()=>setFilter('ALL')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter==='ALL'?'border-primary text-primary':'border-input text-muted-foreground'}`}>
              <Inbox size={14}/> Tous {counts.all>0?`(${counts.all})`:''}
            </button>
            <button onClick={()=>setFilter('FAVORITES')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter==='FAVORITES'?'border-primary text-primary':'border-input text-muted-foreground'}`}>
              <Heart size={14}/> Favoris {counts.fav>0?`(${counts.fav})`:''}
            </button>
            <button onClick={()=>setFilter('UNREAD')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter==='UNREAD'?'border-primary text-primary':'border-input text-muted-foreground'}`}>
              <Mail size={14}/> Non lus {counts.unread>0?`(${counts.unread})`:''}
            </button>
            <button onClick={()=>setFilter('TRASH')} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${filter==='TRASH'?'border-primary text-primary':'border-input text-muted-foreground'}`}>
              <Trash size={14}/> Corbeille {counts.trash>0?`(${counts.trash})`:''}
            </button>
          </div>
          {visible.length === 0 && <p className="text-sm text-muted-foreground">Aucune conversation.</p>}
          <div className="divide-y">
            {shown.map((it) => (
              <div key={it.id} className="flex items-center justify-between py-3 rounded-md px-2 hover:bg-accent">
                <Link href={`/messages/${it.id}`} className="flex-1">
                  <div>
                    <div className={(it.unread>0 ? 'font-semibold' : 'font-medium') + " flex items-center gap-2"}>
                      {it.otherDisplayName}
                      {it.favorite && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px]"><Star size={10}/> Favori</span>}
                    </div>
                    <div className={(it.unread>0 ? 'text-foreground' : 'text-muted-foreground') + " text-xs line-clamp-1"}>{it.lastMessage}</div>
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  {filter!=='TRASH' && (
                    <button title={it.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} onClick={async (e)=>{ e.preventDefault(); await apiClient.favoriteConversation(it.id, !it.favorite); await load(); }}>
                      {it.favorite ? <Star className="text-amber-500" size={16}/> : <StarOff size={16}/>} 
                    </button>
                  )}
                  {filter!=='TRASH' ? (
                    <button title="Mettre à la corbeille" onClick={async (e)=>{ e.preventDefault(); await apiClient.trashConversation(it.id); await load(); }}>
                      <Trash2 size={16} />
                    </button>
                  ) : (
                    <button title="Restaurer" onClick={async (e)=>{ e.preventDefault(); await apiClient.untrashConversation(it.id); await load(); }}>
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
          <button className="text-sm underline" onClick={()=>setLimit((n)=>n+PAGE)}>Charger plus</button>
        </div>
      )}
    </div>
  );
}
