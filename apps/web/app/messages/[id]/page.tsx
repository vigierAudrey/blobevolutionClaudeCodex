"use client";
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';

type Msg = { id: string; senderId: string; type: 'TEXT'|'PROPOSAL'; content: string; meta?: any; createdAt: string };

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [items, setItems] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [showProposal, setShowProposal] = useState(false);
  const [pDate, setPDate] = useState('');
  const [pPlace, setPPlace] = useState('');
  const [pNote, setPNote] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getMessages(id);
      setItems(data.items || []);
      setError(null);
      setTimeout(()=>endRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
    } catch (e: any) {
      setError(e?.message || 'Erreur chargement');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); const t=setInterval(load, 10000); return ()=>clearInterval(t); }, [id]);

  const send = async () => {
    if (!input.trim()) return;
    const body = { type: 'TEXT' as const, content: input.trim() };
    try { await apiClient.sendMessage(id, body as any); setInput(''); await load(); } catch {}
  };

  const sendProposal = async () => {
    if (!pDate || !pPlace) return;
    const meta = { date: pDate, place: pPlace, note: pNote || undefined };
    try { await apiClient.sendMessage(id, { type: 'PROPOSAL', content: `Proposition de session ${pDate} @ ${pPlace}`, meta }); setShowProposal(false); setPDate(''); setPPlace(''); setPNote(''); await load(); } catch {}
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/messages" />
      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {loading && items.length === 0 && <p className="text-sm text-muted-foreground">Chargement…</p>}
          <div className="space-y-2 min-h-[300px]">
            {items.map((m) => (
              <div key={m.id} className="text-sm">
                <div className={"inline-block rounded-lg px-3 py-2 " + (m.type === 'PROPOSAL' ? 'bg-amber-50 border border-amber-200' : 'bg-accent') }>
                  <div>{m.content}</div>
                  {m.type === 'PROPOSAL' && m.meta && (
                    <div className="text-xs text-muted-foreground">
                      {m.meta.date} • {m.meta.place} {m.meta.note ? `• ${m.meta.note}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input className="flex-1 rounded-md border border-input px-3 py-2 text-sm" placeholder="Écrire un message" value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } }} />
            <Button onClick={send}>Envoyer</Button>
            <Button variant="secondary" onClick={()=>setShowProposal((v)=>!v)}>Proposer une session</Button>
          </div>
          {showProposal && (
            <div className="mt-3 rounded-md border p-3 space-y-2">
              <div className="text-sm font-medium">Proposition de session</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input type="date" className="rounded-md border px-2 py-1 text-sm" value={pDate} onChange={(e)=>setPDate(e.target.value)} />
                <input type="text" className="rounded-md border px-2 py-1 text-sm" placeholder="Lieu" value={pPlace} onChange={(e)=>setPPlace(e.target.value)} />
                <input type="text" className="rounded-md border px-2 py-1 text-sm" placeholder="Note (facultatif)" value={pNote} onChange={(e)=>setPNote(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={()=>setShowProposal(false)}>Annuler</Button>
                <Button onClick={sendProposal}>Envoyer la proposition</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

