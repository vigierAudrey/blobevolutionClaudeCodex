"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';
import { Shield, ShieldOff, MoreVertical } from 'lucide-react';
import { apiClient } from '../../../lib/apiClient';
import type {
  Message,
  MessageListResponse,
  MessageMeta,
  SendMessagePayload,
  ThreadListResponse,
  ThreadSummary,
} from '@/types/messages';

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [showProposal, setShowProposal] = useState(false);
  const [pDate, setPDate] = useState('');
  const [pPlace, setPPlace] = useState('');
  const [pNote, setPNote] = useState('');
  const [conversationInfo, setConversationInfo] = useState<ThreadSummary | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const pollingRef = useRef<number | null>(null);

  const scrollToBottom = () => {
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.getMessages(id) as MessageListResponse;
      setMessages(data.items ?? []);
      setError(null);
      scrollToBottom();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const refreshConversationInfo = useCallback(async () => {
    try {
      const conversations = await apiClient.listConversations() as ThreadListResponse;
      const convInfo = conversations.items.find((c) => c.id === id) ?? null;
      setConversationInfo(convInfo);
    } catch (err) {
      console.error('Error loading conversation info:', err);
    }
  }, [id]);

  // Load user info and conversation details
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await apiClient.me();
      } catch {
        router.replace('/login');
        return;
      }

      if (!active) return;
      await Promise.all([refreshConversationInfo(), loadMessages()]);
      if (pollingRef.current === null) {
        pollingRef.current = window.setInterval(() => {
          void loadMessages();
        }, 10000);
      }
    };

    initialize();

    return () => {
      active = false;
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [id, loadMessages, refreshConversationInfo, router]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMenu]);

  const send = async () => {
    if (!input.trim()) return;
    const payload: SendMessagePayload = { type: 'TEXT', content: input.trim() };
    try {
      await apiClient.sendMessage(id, payload);
      setInput('');
      await loadMessages();
    } catch (err) {
      console.error('Failed to send message', err);
    }
  };

  const sendProposal = async () => {
    if (!pDate || !pPlace) return;
    const meta: MessageMeta = { date: pDate, place: pPlace, note: pNote || undefined };
    const payload: SendMessagePayload = {
      type: 'PROPOSAL',
      content: `Proposition de session ${pDate} @ ${pPlace}`,
      meta,
    };
    try {
      await apiClient.sendMessage(id, payload);
      setShowProposal(false);
      setPDate('');
      setPPlace('');
      setPNote('');
      await loadMessages();
    } catch (err) {
      console.error('Failed to send proposal', err);
    }
  };

  const handleBlock = async () => {
    if (!conversationInfo) return;

    try {
      if (conversationInfo.blocked) {
        await apiClient.unblockConversation(id);
      } else {
        if (!window.confirm('Confirmer le blocage de ce contact ?')) {
          return;
        }
        await apiClient.blockConversation(id);
      }

      await refreshConversationInfo();
      setShowMenu(false);
    } catch (err) {
      console.error('Error blocking/unblocking:', err);
      alert('Erreur lors du blocage ou du déblocage');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/messages" />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Conversation
              {conversationInfo?.otherDisplayName && (
                <span className="text-base font-normal">
                  avec {conversationInfo.otherDisplayName}
                </span>
              )}
              {conversationInfo?.blocked && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-1 text-xs">
                  <Shield size={12}/> Bloqué
                </span>
              )}
            </CardTitle>
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMenu(!showMenu)}
                className="p-2"
              >
                <MoreVertical size={16} />
              </Button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border rounded-md shadow-lg z-10 min-w-[180px]">
                  <button
                    onClick={handleBlock}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                  >
                    {conversationInfo?.blocked ? (
                      <>
                        <ShieldOff size={14} />
                        Débloquer ce contact
                      </>
                    ) : (
                      <>
                        <Shield size={14} />
                        Bloquer ce contact
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {loading && messages.length === 0 && <p className="text-sm text-muted-foreground">Chargement…</p>}
          <div className="space-y-2 min-h-[300px]">
            {messages.map((m) => (
              <div key={m.id} className="text-sm">
                <div className={"inline-block rounded-lg px-3 py-2 " + (m.type === 'PROPOSAL' ? 'bg-amber-50 border border-amber-200' : 'bg-accent') }>
                  <div>{m.content}</div>
                  {m.type === 'PROPOSAL' && m.meta && (
                    <div className="text-xs text-muted-foreground">
                      {m.meta?.date} • {m.meta?.place} {m.meta?.note ? `• ${m.meta.note}` : ''}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {conversationInfo?.blocked ? (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-center gap-2 text-red-700 text-sm">
                <Shield size={16} />
                <span>Ce contact est bloqué. Vous ne pouvez plus envoyer de messages.</span>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <input className="flex-1 rounded-md border border-input px-3 py-2 text-sm" placeholder="Écrire un message" value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } }} />
              <Button onClick={send}>Envoyer</Button>
              <Button variant="secondary" onClick={()=>setShowProposal((v)=>!v)}>Proposer une session</Button>
            </div>
          )}
          {showProposal && !conversationInfo?.blocked && (
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
