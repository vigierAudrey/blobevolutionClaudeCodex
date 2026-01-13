"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import type {
  Message,
  MessageListResponse,
  MessageMeta,
  ThreadListResponse,
  ThreadSummary
} from '@/types/messages';
import { MoreVertical, Shield, ShieldOff, Wifi, WifiOff } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useChat } from '../../../hooks/useChat';
import { apiClient } from '../../../lib/apiClient';
import { getUserFacingMessage } from '../../../lib/getUserFacingMessage';
import { normalizeAppError } from '../../../lib/normalizeAppError';
import { ERROR_CODES } from '../../../lib/socketAck';

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
 * C3: Optimistic message for pending/failed state
 */
interface OptimisticMessage {
  clientMsgId: string;
  content: string;
  type: 'TEXT' | 'PROPOSAL';
  meta?: MessageMeta;
  status: 'pending' | 'failed';
  createdAtLocal: number;
  lastErrorUserText?: string;
  inFlight: boolean;
}

/**
 * Generate unique clientMsgId
 */
function generateClientMsgId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

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
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
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

      // C3: Reconciliation - supprimer l'optimistic correspondant
      setOptimisticMessages(prev => {
        // Trouver le premier pending correspondant (pas les failed)
        const matchIndex = prev.findIndex(opt =>
          opt.status === 'pending' &&
          opt.type === formattedMessage.type &&
          opt.content === formattedMessage.content &&
          (Date.now() - opt.createdAtLocal) < 10000 // 10s window
        );

        if (matchIndex !== -1) {
          // Supprimer AU PLUS 1 optimistic
          return prev.filter((_, i) => i !== matchIndex);
        }
        return prev;
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

  // C3: Cleanup orphan optimistic messages (timeout très long)
  useEffect(() => {
    const interval = setInterval(() => {
      setOptimisticMessages(prev =>
        prev.filter(opt =>
          opt.status === 'failed' || // Garder failed pour retry
          opt.inFlight || // Garder inFlight (en cours)
          (Date.now() - opt.createdAtLocal) < 120000 // < 120s
        )
      );
    }, 60000); // Check toutes les 60s

    return () => clearInterval(interval);
  }, []);

  const send = async () => {
    if (!input.trim()) return;
    if (rateLimitedUntil && Date.now() < rateLimitedUntil) return; // Prevent send during cooldown

    const trimmedInput = input.trim();

    // C3: Anti-dup - vérifier si déjà en cours (single-flight par clientMsgId)
    const alreadyInFlight = optimisticMessages.some(m => m.inFlight);
    if (alreadyInFlight) {
      return; // Ignorer silently
    }

    // C3: Créer optimistic message
    const clientMsgId = generateClientMsgId();
    const optimistic: OptimisticMessage = {
      clientMsgId,
      content: trimmedInput,
      type: 'TEXT',
      status: 'pending',
      createdAtLocal: Date.now(),
      inFlight: true,
    };

    setOptimisticMessages(prev => [...prev, optimistic]);
    setInput(''); // Clear immédiatement (UX responsive)
    scrollToBottom();

    // C2: sendMessage now handles WS→HTTP fallback internally
    const result = await sendMessage(trimmedInput, 'TEXT');

    if (result.success) {
      // Marquer inFlight=false
      setOptimisticMessages(prev =>
        prev.map(m =>
          m.clientMsgId === clientMsgId
            ? { ...m, inFlight: false }
            : m
        )
      );

      setError(null);

      // Reload messages if HTTP fallback was used + cleanup optimistic
      if (result.transport === 'HTTP') {
        await loadMessages();
        // Supprimer les optimistic pending récents (réconciliation après reload)
        setOptimisticMessages(prev =>
          prev.filter(opt =>
            opt.status === 'failed' || // Garder failed pour retry
            (Date.now() - opt.createdAtLocal) >= 5000 // Garder seulement très anciens (edge case)
          )
        );
      }
      // WS: attendre onNewMessage pour réconciliation automatique

      return;
    }

    // Failed: normalize error and show to user
    const appErr = normalizeAppError(result.error);

    // Log unknown error codes (telemetry)
    logUnknownCode(appErr);

    const userMsg = getUserFacingMessage(appErr, {
      domain: 'chat',
      action: 'send-message',
    });

    // Marquer optimistic en failed
    setOptimisticMessages(prev =>
      prev.map(m =>
        m.clientMsgId === clientMsgId
          ? { ...m, inFlight: false, status: 'failed', lastErrorUserText: userMsg.text }
          : m
      )
    );

    // RATE_LIMITED: activate cooldown UI
    if (appErr.code === ERROR_CODES.RATE_LIMITED && appErr.retryAfterSeconds) {
      const cooldownUntil = Date.now() + (appErr.retryAfterSeconds * 1000);
      setRateLimitedUntil(cooldownUntil);
    }

    setError(userMsg.text);
  };

  const sendProposal = async () => {
    if (!pDate || !pPlace) return;

    // C3: Anti-dup - vérifier si déjà en cours
    const alreadyInFlight = optimisticMessages.some(m => m.inFlight);
    if (alreadyInFlight) {
      return; // Ignorer silently
    }

    const meta: MessageMeta = { date: pDate, place: pPlace, note: pNote || undefined };
    const content = `Proposition de session ${pDate} @ ${pPlace}`;

    // C3: Créer optimistic message
    const clientMsgId = generateClientMsgId();
    const optimistic: OptimisticMessage = {
      clientMsgId,
      content,
      type: 'PROPOSAL',
      meta,
      status: 'pending',
      createdAtLocal: Date.now(),
      inFlight: true,
    };

    setOptimisticMessages(prev => [...prev, optimistic]);
    scrollToBottom();

    // C2: sendMessage now handles WS→HTTP fallback internally
    const result = await sendMessage(content, 'PROPOSAL', meta);

    if (result.success) {
      // Marquer inFlight=false
      setOptimisticMessages(prev =>
        prev.map(m =>
          m.clientMsgId === clientMsgId
            ? { ...m, inFlight: false }
            : m
        )
      );

      setShowProposal(false);
      setPDate('');
      setPPlace('');
      setPNote('');
      setError(null);

      // Reload messages if HTTP fallback was used + cleanup optimistic
      if (result.transport === 'HTTP') {
        await loadMessages();
        setOptimisticMessages(prev =>
          prev.filter(opt =>
            opt.status === 'failed' ||
            (Date.now() - opt.createdAtLocal) >= 5000
          )
        );
      }
      // WS: attendre onNewMessage pour réconciliation

      return;
    }

    // Failed: normalize error and show to user
    const appErr = normalizeAppError(result.error);

    // Log unknown error codes
    logUnknownCode(appErr);

    const userMsg = getUserFacingMessage(appErr, {
      domain: 'chat',
      action: 'send-proposal',
    });

    // Marquer optimistic en failed
    setOptimisticMessages(prev =>
      prev.map(m =>
        m.clientMsgId === clientMsgId
          ? { ...m, inFlight: false, status: 'failed', lastErrorUserText: userMsg.text }
          : m
      )
    );

    // RATE_LIMITED: activate cooldown
    if (appErr.code === ERROR_CODES.RATE_LIMITED && appErr.retryAfterSeconds) {
      const cooldownUntil = Date.now() + (appErr.retryAfterSeconds * 1000);
      setRateLimitedUntil(cooldownUntil);
    }

    setError(userMsg.text);
  };

  // C3: Retry failed message
  const retryMessage = async (clientMsgId: string) => {
    const optMsg = optimisticMessages.find(m => m.clientMsgId === clientMsgId);
    if (!optMsg || optMsg.inFlight || optMsg.status !== 'failed') {
      return; // Guard: only retry failed non-inFlight messages
    }

    // Vérifier cooldown
    if (rateLimitedUntil && Date.now() < rateLimitedUntil) {
      return; // Ignorer pendant cooldown
    }

    // Réactiver (même clientMsgId = no new optimistic)
    setOptimisticMessages(prev =>
      prev.map(m =>
        m.clientMsgId === clientMsgId
          ? { ...m, status: 'pending', inFlight: true, lastErrorUserText: undefined }
          : m
      )
    );

    // Réessayer
    const result = await sendMessage(optMsg.content, optMsg.type, optMsg.meta);

    if (result.success) {
      // Marquer inFlight=false
      setOptimisticMessages(prev =>
        prev.map(m =>
          m.clientMsgId === clientMsgId
            ? { ...m, inFlight: false }
            : m
        )
      );

      setError(null);

      // Reload + cleanup si HTTP fallback
      if (result.transport === 'HTTP') {
        await loadMessages();
        setOptimisticMessages(prev =>
          prev.filter(opt =>
            opt.status === 'failed' ||
            (Date.now() - opt.createdAtLocal) >= 5000
          )
        );
      }

      return;
    }

    // Failed again
    const appErr = normalizeAppError(result.error);
    logUnknownCode(appErr);

    const userMsg = getUserFacingMessage(appErr, {
      domain: 'chat',
      action: optMsg.type === 'PROPOSAL' ? 'send-proposal' : 'send-message',
    });

    // Re-marquer failed
    setOptimisticMessages(prev =>
      prev.map(m =>
        m.clientMsgId === clientMsgId
          ? { ...m, inFlight: false, status: 'failed', lastErrorUserText: userMsg.text }
          : m
      )
    );

    // RATE_LIMITED
    if (appErr.code === ERROR_CODES.RATE_LIMITED && appErr.retryAfterSeconds) {
      const cooldownUntil = Date.now() + (appErr.retryAfterSeconds * 1000);
      setRateLimitedUntil(cooldownUntil);
    }

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
            {/* Messages serveur normaux */}
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

            {/* C3: Messages optimistic (pending/failed) */}
            {optimisticMessages.map((opt) => (
              <div key={opt.clientMsgId} className="text-sm">
                <div className={
                  "inline-block rounded-lg px-3 py-2 " +
                  (opt.type === 'PROPOSAL' ? 'bg-amber-50 border border-amber-200' : 'bg-accent') +
                  (opt.status === 'failed' ? ' opacity-60 border-red-300' : ' opacity-75')
                }>
                  <div>{opt.content}</div>
                  {opt.type === 'PROPOSAL' && opt.meta && (
                    <div className="text-xs text-muted-foreground">
                      {opt.meta?.date} • {opt.meta?.place} {opt.meta?.note ? `• ${opt.meta.note}` : ''}
                    </div>
                  )}

                  {/* Badge status */}
                  <div className="text-xs text-muted-foreground mt-1">
                    {opt.status === 'pending' && '⏳ Envoi…'}
                    {opt.status === 'failed' && (
                      <span className="text-red-600">
                        ⚠️ Échec
                        {!rateLimitedUntil && !opt.inFlight && (
                          <button
                            onClick={() => retryMessage(opt.clientMsgId)}
                            className="ml-2 underline text-blue-600 hover:text-blue-800"
                          >
                            Réessayer
                          </button>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Erreur user-facing */}
                  {opt.status === 'failed' && opt.lastErrorUserText && (
                    <div className="text-xs text-red-600 mt-1">{opt.lastErrorUserText}</div>
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
              {/* C3: Disable also si message inFlight */}
              <Button
                onClick={send}
                disabled={
                  !!rateLimitedUntil ||
                  !input.trim() ||
                  optimisticMessages.some(m => m.inFlight)
                }
              >
                {cooldownSeconds > 0 ? `Attendre ${cooldownSeconds}s` : 'Envoyer'}
              </Button>
              <Button
                variant="secondary"
                onClick={()=>setShowProposal((v)=>!v)}
                disabled={!!rateLimitedUntil || optimisticMessages.some(m => m.inFlight)}
              >
                Proposer une session
              </Button>
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
                <Button
                  onClick={sendProposal}
                  disabled={optimisticMessages.some(m => m.inFlight)}
                >
                  Envoyer la proposition
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
