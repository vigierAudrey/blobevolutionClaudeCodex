"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { BackBar } from '../../../components/BackBar';
import { Shield, ShieldOff, MoreVertical, Users, Clock, AlertCircle, ArrowDown } from 'lucide-react';
import { apiClient } from '../../../lib/apiClient';
import { ConversationMembers } from '../../../components/ConversationMembers';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobDashboardShell, BlobEmptyState } from '@/components/blob';
import type {
  Message,
  MessageListResponse,
  SendMessagePayload,
  ThreadSummary,
} from '@/types/messages';

// Helper functions for date formatting
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Reset time for comparison
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

  if (dateOnly.getTime() === todayOnly.getTime()) {
    return "Aujourd'hui";
  } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
    return 'Hier';
  } else {
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
}

function isSameDay(date1: string, date2: string): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [conversationInfo, setConversationInfo] = useState<ThreadSummary | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const pollingRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const sendingRef = useRef(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  const loadMessages = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      setLoading(true);
      const data = await apiClient.getMessages(id) as MessageListResponse;
      setMessages(data.items ?? []);
      setError(null);
      scrollToBottom();
    } catch {
      setError('Impossible de charger les messages pour le moment.');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [id]);

  const refreshConversationInfo = useCallback(async () => {
    try {
      const convInfo = await apiClient.findConversationById(id);
      setConversationInfo(convInfo);
    } catch {
      setConversationInfo(null);
    }
  }, [id]);

  // Load user info and conversation details
  useEffect(() => {
    let active = true;
    const stopPolling = () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
    const startPolling = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      stopPolling();
      pollingRef.current = window.setInterval(() => {
        void loadMessages();
      }, 10000);
    };
    const onVisibility = () => {
      if (!active) return;
      if (document.visibilityState === 'visible') {
        void loadMessages();
        startPolling();
      } else {
        stopPolling();
      }
    };

    const initialize = async () => {
      try {
        await apiClient.me();
      } catch (err) {
        const code = typeof (err as { code?: unknown })?.code === 'string'
          ? (err as { code: string }).code : null;
        const status = typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status : null;
        if (code === 'SESSION_EXPIRED' || status === 401) {
          router.replace('/login');
        }
        return;
      }

      if (!active) return;
      await Promise.all([refreshConversationInfo(), loadMessages()]);
      if (!active) return;
      startPolling();
    };

    void initialize();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      stopPolling();
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

  // Detect scroll position to show/hide scroll button
  useEffect(() => {
    const handleScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY;
      const distanceFromBottom = documentHeight - (scrollTop + windowHeight);

      // Show button if we're more than 200px from bottom
      setShowScrollButton(distanceFromBottom > 200);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const send = async () => {
    if (!input.trim() || sendingRef.current || conversationInfo?.blocked) return;
    sendingRef.current = true;
    setSending(true);
    const payload: SendMessagePayload = { type: 'TEXT', content: input.trim() };
    const messageContent = input.trim();
    setInput(''); // Clear input immediately

    // Optimistic UI: Add message immediately with temporary ID
    const tempMessage: Message = {
      id: `temp-${Date.now()}`,
      senderId: 'current-user',
      type: 'TEXT',
      content: messageContent,
      createdAt: new Date().toISOString(),
      senderName: 'Vous',
      senderPhotoUrl: null,
      isCurrentUser: true,
      meta: { sending: true }, // Mark as sending
    };

    setMessages(prev => [...prev, tempMessage]);
    scrollToBottom();

    try {
      await apiClient.sendMessage(id, payload);
      // Reload to get the real message with server ID
      await loadMessages();
    } catch {
      setError('Impossible d’envoyer le message pour le moment.');
      // Mark message as failed
      setMessages(prev => prev.map(m =>
        m.id === tempMessage.id
          ? { ...m, meta: { ...m.meta, failed: true, sending: false } }
          : m
      ));
    } finally {
      setSending(false);
      sendingRef.current = false;
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
    } catch {
      setError('Impossible de modifier le statut de cette conversation.');
    }
  };

  return (
    <BlobDashboardShell
      title={conversationInfo?.isGroup ? 'Conversation groupe' : 'Conversation'}
      nav={[
        { label: 'Liste', href: '/messages', icon: <Users size={16} /> },
        { label: 'Dashboard', href: '/dashboard', icon: <Shield size={16} /> },
      ]}
    >
      <div className="mx-auto max-w-2xl space-y-4 pb-8">
        <BackBar fallbackHref="/messages" />
        <BlobCard className="bg-white">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 border-b-2 border-blob-sand-deep pb-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {conversationInfo?.isGroup ? (
                    <>
                      <BlobBadge variant="dark"><Users size={16} /> Groupe</BlobBadge>
                      <span className="text-sm font-medium text-blob-black/64">
                        {conversationInfo.memberCount} membres
                      </span>
                    </>
                  ) : (
                    <h2 className="text-xl font-black uppercase tracking-widest">
                      {conversationInfo?.otherDisplayName ? `Avec ${conversationInfo.otherDisplayName}` : 'Conversation'}
                    </h2>
                  )}
                  {conversationInfo?.blocked && (
                    <BlobBadge variant="error"><Shield size={12} /> Bloqué</BlobBadge>
                  )}
                </div>
                {conversationInfo?.matchedAt && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-blob-black/56">
                    <Clock size={12} />
                    Matchés le {new Date(conversationInfo.matchedAt).toLocaleDateString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu(!showMenu)}
                  className="flex h-9 w-9 items-center justify-center rounded-sm border-2 border-blob-black bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                  aria-label="Options de conversation"
                >
                  <MoreVertical size={16} />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full z-10 mt-1 min-w-[190px] rounded-sm border-2 border-blob-black bg-white shadow-lg">
                    <button
                      type="button"
                      onClick={handleBlock}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blob-black hover:bg-blob-sand"
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

            {error && <BlobAlert variant="error">{error}</BlobAlert>}
            {loading && messages.length === 0 && <BlobAlert variant="info">Chargement...</BlobAlert>}
            {!loading && messages.length === 0 && (
              <BlobEmptyState title="Aucun message" description="Le poste de liaison est prêt pour le premier message." />
            )}

            <div className="min-h-[300px] space-y-1" ref={messagesContainerRef} aria-live="polite">
              {messages.map((m, index) => {
              const isCurrentUser = m.isCurrentUser;
              const senderName = m.senderName || 'Utilisateur';
              const senderPhotoUrl = m.senderPhotoUrl;
              const isSending = m.meta && 'sending' in m.meta && Boolean(m.meta.sending);
              const isFailed = m.meta && 'failed' in m.meta && Boolean(m.meta.failed);

              // Check if we need a date separator
              const showDateSeparator = index === 0 || !isSameDay(messages[index - 1].createdAt, m.createdAt);

              // Check if we should group with previous message (same sender, within 2 minutes)
              const prevMessage = index > 0 ? messages[index - 1] : null;
              const shouldGroup = prevMessage &&
                prevMessage.isCurrentUser === isCurrentUser &&
                prevMessage.senderId === m.senderId &&
                isSameDay(prevMessage.createdAt, m.createdAt) &&
                (new Date(m.createdAt).getTime() - new Date(prevMessage.createdAt).getTime()) < 120000; // 2 min

              return (
                <div key={m.id}>
                  {/* Date separator */}
                  {showDateSeparator && (
                    <div className="my-4 flex items-center justify-center">
                      <div className="rounded-sm border-2 border-blob-sand-deep bg-blob-sand px-3 py-1 text-xs font-black uppercase tracking-widest text-blob-black/64">
                        {formatDateSeparator(m.createdAt)}
                      </div>
                    </div>
                  )}

                  {/* Message */}
                  <div className={`flex gap-2 ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'} ${shouldGroup ? 'mt-0.5' : 'mt-4'}`}>
                    {/* Avatar / Miniature - only show if not grouped */}
                    <div className="flex-shrink-0">
                      {!shouldGroup ? (
                        senderPhotoUrl ? (
                          <Image
                            src={senderPhotoUrl}
                            alt={senderName}
                            width={32}
                            height={32}
                            className="rounded-sm border-2 border-blob-black object-cover"
                          />
                        ) : (
                          <div className={`flex h-8 w-8 items-center justify-center rounded-sm border-2 border-blob-black text-xs font-black ${
                            isCurrentUser ? 'bg-blob-yellow text-blob-black' : 'bg-blob-black text-white'
                          }`}>
                            {senderName[0].toUpperCase()}
                          </div>
                        )
                      ) : (
                        <div className="w-8 h-8" /> // Spacer
                      )}
                    </div>

                    {/* Message bubble */}
                    <div className={`flex max-w-[78%] flex-col ${isCurrentUser ? 'items-end' : 'items-start'}`}>
                      {!isCurrentUser && !shouldGroup && (
                        <span className="mb-1 px-1 text-xs font-medium text-blob-black/56">{senderName}</span>
                      )}
                      <div className={`rounded-sm border-2 px-3 py-2 ${
                        m.type === 'PROPOSAL'
                          ? 'border-blob-yellow-dark bg-blob-yellow/20 text-blob-black'
                          : isCurrentUser
                            ? 'border-blob-black bg-blob-black text-white'
                            : 'border-blob-sand-deep bg-blob-sand text-blob-black'
                      } ${isFailed ? 'opacity-60' : ''}`}>
                        <div className="text-sm break-words">{m.content}</div>
                        {m.type === 'PROPOSAL' && m.meta && (
                          <div className="mt-1 text-xs text-blob-black/64">
                            {m.meta?.date} • {m.meta?.place} {m.meta?.note ? `• ${m.meta.note}` : ''}
                          </div>
                        )}
                      </div>
                      {/* Time and status */}
                      <div className="mt-1 flex items-center gap-1 px-1 text-xs text-blob-black/56">
                        {formatTime(m.createdAt)}
                        {isCurrentUser && !isSending && !isFailed && (
                          <span title="Envoyé">✓✓</span>
                        )}
                        {isSending && <Clock size={12} className="animate-pulse" />}
                        {isFailed && (
                          <>
                            <AlertCircle size={12} className="text-red-500" />
                            <button
                              onClick={async () => {
                                // Retry sending
                                setMessages(prev => prev.filter(msg => msg.id !== m.id));
                                setInput(m.content);
                                setTimeout(() => send(), 100);
                              }}
                              className="text-xs font-medium text-red-700 underline"
                            >
                              Réessayer
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {conversationInfo?.blocked ? (
            <BlobAlert variant="error">
              <div className="flex items-center gap-2 text-sm">
                <Shield size={16} />
                <span>Ce contact est bloqué. Vous ne pouvez plus envoyer de messages.</span>
              </div>
            </BlobAlert>
          ) : (
            <div className="mt-3 flex flex-col items-stretch gap-2 border-t-2 border-blob-sand-deep pt-4 sm:flex-row sm:items-center">
              <input
                className="flex-1 rounded-sm border-2 border-blob-black bg-white px-3 py-2 text-sm text-blob-black placeholder:text-blob-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                placeholder="Écrire un message"
                value={input}
                onChange={(e)=>setInput(e.target.value)}
                onKeyDown={(e)=>{ if(e.key==='Enter' && !sending){ e.preventDefault(); void send(); } }}
                disabled={sending}
              />
              <BlobButton
                type="button"
                onClick={() => void send()}
                className="w-full sm:w-auto"
                disabled={sending || !input.trim()}
              >
                {sending ? 'Envoi...' : 'Envoyer'}
              </BlobButton>
            </div>
          )}

          <ConversationMembers
            conversationId={id}
            onMemberAdded={() => {
              void loadMessages();
              void refreshConversationInfo();
            }}
            onMemberRemoved={() => {
              void loadMessages();
              void refreshConversationInfo();
            }}
          />
          </div>
        </BlobCard>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-24 right-6 z-50 rounded-sm border-2 border-blob-black bg-blob-yellow p-3 text-blob-black shadow-lg transition-all duration-200"
          aria-label="Descendre en bas de la conversation"
        >
          <ArrowDown size={24} />
        </button>
      )}
      </div>
    </BlobDashboardShell>
  );
}
