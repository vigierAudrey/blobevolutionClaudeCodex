"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';
import { Shield, ShieldOff, MoreVertical, Wifi, WifiOff } from 'lucide-react';
import { apiClient } from '../../../lib/apiClient';
import { useChat } from '../../../hooks/useChat';
import { normalizeAppError } from '../../../lib/normalizeAppError';
import { getUserFacingMessage } from '../../../lib/getUserFacingMessage';
import { ERROR_CODES } from '../../../lib/socketAck';
import type {
  Message,
  MessageListResponse,
  MessageMeta,
  SendMessagePayload,
  ThreadListResponse,
  ThreadSummary,
} from '@/types/messages';

// Known client-only error codes (not from server ERROR_CODES)
const KNOWN_CLIENT_CODES = new Set([
  'CLIENT_TIMEOUT',
  'NOT_CONNECTED',
  'NO_SOCKET',
  'AUTH_FAILED',
  'CONNECT_ERROR',
  'INVALID_ENVELOPE',
  'INVALID_RESPONSE',
  'INVALID_JSON',
]);

/**
 * Log unknown error codes for telemetry
 * @param appErr - Normalized AppError
 */
function logUnknownCode(appErr: { code: string; source: string; debug?: unknown }) {
  const isServerCode = Object.values(ERROR_CODES).includes(appErr.code as any);
  const isClientCode = KNOWN_CLIENT_CODES.has(appErr.code);

  if (!isServerCode && !isClientCode) {
    console.warn('[UNKNOWN_ERROR_CODE]', {
      code: appErr.code,
      source: appErr.source, // debug/telemetry only
      debug: appErr.debug,
    });
  }
}

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
  const [accessToken, setAccessToken] = useState<string>('');
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  // ✨ WebSocket chat integration
  const { connected, sendMessage, setTyping, otherUserTyping, lastError } = useChat({
    conversationId: id,
    token: accessToken,
    onNewMessage: (newMessage) => {
      // Convertir le format du message WebSocket vers le format attendu
      const formattedMessage: Message = {
        id: newMessage.id,
        senderId: newMessage.senderId,
        type: newMessage.type,
        content: newMessage.content,
        meta: newMessage.meta as MessageMeta || null,
        createdAt: new Date(newMessage.createdAt).toISOString()
      };

      setMessages(prev => {
        // Éviter les doublons
        if (prev.some(m => m.id === formattedMessage.id)) {
          return prev;
        }
        return [...prev, formattedMessage];
      });
      scrollToBottom();
    }
  });

  // Remonter socket errors vers UI (sauf RATE_LIMITED qui a sa propre UI)
  useEffect(() => {
    if (!lastError) return;

    // Normaliser l'erreur socket
    const appErr = normalizeAppError(lastError);

    // Log unknown error codes (telemetry)
    logUnknownCode(appErr);

    // Skip RATE_LIMITED (has dedicated UI)
    if (appErr.code === ERROR_CODES.RATE_LIMITED) {
      return;
    }

    // Get user-facing message
    const userMsg = getUserFacingMessage(appErr, {
      domain: 'chat',
      action: 'socket-error',
    });

    // Display user message (not raw error)
    setError(userMsg.text);
  }, [lastError]);

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
      const convInfo = (conversations.items ?? []).find((c: ThreadSummary) => c.id === id) ?? null;
      setConversationInfo(convInfo);
    } catch (err) {
      // ✅ E-REVIEW P0 #4: Pas de console.error, erreur silencieuse ou UI
      setError('Erreur de chargement des informations');
    }
  }, [id]);

  // Load user info and conversation details
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await apiClient.me();

        // Récupérer le token d'accès depuis localStorage
        const token = localStorage.getItem('accessToken');
        if (token) {
          setAccessToken(token);
        }
      } catch {
        router.replace('/login');
        return;
      }

      if (!active) return;
      await Promise.all([refreshConversationInfo(), loadMessages()]);
    };

    initialize();

    return () => {
      active = false;
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

  // ✨ Indicateur de frappe
  useEffect(() => {
    if (!input || !connected) return;

    setTyping(true);

    const timeout = setTimeout(() => {
      setTyping(false);
    }, 3000);

    return () => {
      clearTimeout(timeout);
      setTyping(false);
    };
  }, [input, connected, setTyping]);

  // ✅ PATCH 3 (P1 #4): Cooldown countdown pour rate limiting
  useEffect(() => {
    if (!rateLimitedUntil) {
      setCooldownSeconds(0);
      return;
    }

    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);

      if (remaining === 0) {
        setRateLimitedUntil(null);
        setError(null);
      }
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);

    return () => clearInterval(interval);
  }, [rateLimitedUntil]);

  const send = async () => {
    if (!input.trim()) return;
    if (rateLimitedUntil && Date.now() < rateLimitedUntil) return; // Prevent send during cooldown

    // C2: sendMessage now handles WS→HTTP fallback internally
    const result = await sendMessage(input.trim(), 'TEXT');

    if (result.success) {
      setInput('');
      setError(null);
      // Reload messages if HTTP fallback was used (optimistic WS messages already handled)
      if (result.transport === 'HTTP') {
        await loadMessages();
      }
      return;
    }

    // Failed: normalize error and show to user
    const appErr = normalizeAppError(result.error);

    // Log unknown error codes (telemetry)
    logUnknownCode(appErr);

    // RATE_LIMITED: activate cooldown UI
    if (appErr.code === ERROR_CODES.RATE_LIMITED && appErr.retryAfterSeconds) {
      const cooldownUntil = Date.now() + (appErr.retryAfterSeconds * 1000);
      setRateLimitedUntil(cooldownUntil);

      const userMsg = getUserFacingMessage(appErr, {
        domain: 'chat',
        action: 'send-message',
      });

      setError(userMsg.text);
      return;
    }

    // Other errors: show user message
    const userMsg = getUserFacingMessage(appErr, {
      domain: 'chat',
      action: 'send-message',
    });

    setError(userMsg.text);
  };

  const sendProposal = async () => {
    if (!pDate || !pPlace) return;
    const meta: MessageMeta = { date: pDate, place: pPlace, note: pNote || undefined };
    const content = `Proposition de session ${pDate} @ ${pPlace}`;

    // C2: sendMessage now handles WS→HTTP fallback internally
    const result = await sendMessage(content, 'PROPOSAL', meta);

    if (result.success) {
      setShowProposal(false);
      setPDate('');
      setPPlace('');
      setPNote('');
      setError(null);
      // Reload messages if HTTP fallback was used
      if (result.transport === 'HTTP') {
        await loadMessages();
      }
      return;
    }

    // Failed: normalize error and show to user
    const appErr = normalizeAppError(result.error);

    // Log unknown error codes
    logUnknownCode(appErr);

    // RATE_LIMITED: activate cooldown
    if (appErr.code === ERROR_CODES.RATE_LIMITED && appErr.retryAfterSeconds) {
      const cooldownUntil = Date.now() + (appErr.retryAfterSeconds * 1000);
      setRateLimitedUntil(cooldownUntil);

      const userMsg = getUserFacingMessage(appErr, {
        domain: 'chat',
        action: 'send-proposal',
      });

      setError(userMsg.text);
      return;
    }

    // Other errors
    const userMsg = getUserFacingMessage(appErr, {
      domain: 'chat',
      action: 'send-proposal',
    });

    setError(userMsg.text);
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
      // ✅ E-REVIEW P0 #4: Pas de console.error, UI uniquement
      setError('Erreur lors du blocage ou du déblocage');
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
              {/* ✨ Indicateur de connexion WebSocket */}
              {connected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-1 text-xs">
                  <Wifi size={12}/> Temps réel
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-700 px-2 py-1 text-xs">
                  <WifiOff size={12}/> Hors ligne
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
            {/* ✨ Indicateur de frappe */}
            {otherUserTyping && (
              <div className="text-xs text-muted-foreground italic">
                {conversationInfo?.otherDisplayName || 'L\'autre utilisateur'} est en train d&apos;écrire...
              </div>
            )}
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
              <input
                className="flex-1 rounded-md border border-input px-3 py-2 text-sm"
                placeholder="Écrire un message"
                value={input}
                onChange={(e)=>setInput(e.target.value)}
                onKeyDown={(e)=>{
                  if(e.key==='Enter' && !rateLimitedUntil){
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={!!rateLimitedUntil}
              />
              {/* ✅ PATCH 3 (P1 #4): Disable button + countdown pendant rate limit */}
              <Button onClick={send} disabled={!!rateLimitedUntil || !input.trim()}>
                {cooldownSeconds > 0 ? `Attendre ${cooldownSeconds}s` : 'Envoyer'}
              </Button>
              <Button variant="secondary" onClick={()=>setShowProposal((v)=>!v)} disabled={!!rateLimitedUntil}>Proposer une session</Button>
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
