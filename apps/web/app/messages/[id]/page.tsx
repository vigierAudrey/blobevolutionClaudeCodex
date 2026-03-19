"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';
import { Shield, ShieldOff, MoreVertical, Users, Clock, AlertCircle, ArrowDown } from 'lucide-react';
import { apiClient } from '../../../lib/apiClient';
import { ConversationMembers } from '../../../components/ConversationMembers';
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
  const endRef = useRef<HTMLDivElement | null>(null);
  const pollingRef = useRef<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

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
      const convInfo = await apiClient.findConversationById(id);
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
    if (!input.trim()) return;
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
    } catch (err) {
      console.error('Failed to send message', err);
      // Mark message as failed
      setMessages(prev => prev.map(m =>
        m.id === tempMessage.id
          ? { ...m, meta: { ...m.meta, failed: true, sending: false } }
          : m
      ));
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
            <div className="flex flex-col gap-1 flex-1">
              <CardTitle className="flex items-center gap-2 flex-wrap">
                {conversationInfo?.isGroup ? (
                  <>
                    <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white px-3 py-1.5 text-sm font-semibold">
                      <Users size={16} />
                      Groupe
                    </span>
                    <span className="text-base font-normal text-muted-foreground">
                      {conversationInfo.memberCount} membres
                    </span>
                  </>
                ) : (
                  <>
                    Conversation
                    {conversationInfo?.otherDisplayName && (
                      <span className="text-base font-normal">
                        avec {conversationInfo.otherDisplayName}
                      </span>
                    )}
                  </>
                )}
                {conversationInfo?.blocked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2 py-1 text-xs">
                    <Shield size={12}/> Bloqué
                  </span>
                )}
              </CardTitle>
              {conversationInfo?.matchedAt && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={12} />
                  Matchés le {new Date(conversationInfo.matchedAt).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}
                </p>
              )}
            </div>
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
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-border rounded-md shadow-lg z-10 min-w-[180px]">
                  <button
                    onClick={handleBlock}
                    className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2"
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
          <div className="space-y-1 min-h-[300px]" ref={messagesContainerRef}>
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
                    <div className="flex items-center justify-center my-4">
                      <div className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
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
                            className="rounded-full object-cover"
                          />
                        ) : (
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold ${
                            isCurrentUser ? 'bg-blue-500' : 'bg-gray-500'
                          }`}>
                            {senderName[0].toUpperCase()}
                          </div>
                        )
                      ) : (
                        <div className="w-8 h-8" /> // Spacer
                      )}
                    </div>

                    {/* Message bubble */}
                    <div className={`flex flex-col ${isCurrentUser ? 'items-end' : 'items-start'} max-w-[70%]`}>
                      {!isCurrentUser && !shouldGroup && (
                        <span className="text-xs text-muted-foreground mb-1 px-1">{senderName}</span>
                      )}
                      <div className={`rounded-lg px-3 py-2 ${
                        m.type === 'PROPOSAL'
                          ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800'
                          : isCurrentUser
                            ? 'bg-blue-500 text-white'
                            : 'bg-accent text-foreground'
                      } ${isFailed ? 'opacity-60' : ''}`}>
                        <div className="text-sm break-words">{m.content}</div>
                        {m.type === 'PROPOSAL' && m.meta && (
                          <div className="text-xs text-muted-foreground dark:text-amber-300 mt-1">
                            {m.meta?.date} • {m.meta?.place} {m.meta?.note ? `• ${m.meta.note}` : ''}
                          </div>
                        )}
                      </div>
                      {/* Time and status */}
                      <div className={`flex items-center gap-1 text-xs mt-1 px-1 ${
                        isCurrentUser ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'
                      }`}>
                        {formatTime(m.createdAt)}
                        {isCurrentUser && !isSending && !isFailed && (
                          <span className="text-gray-400" title="Envoyé">✓✓</span>
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
                              className="text-red-500 underline text-xs"
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
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm">
                <Shield size={16} />
                <span>Ce contact est bloqué. Vous ne pouvez plus envoyer de messages.</span>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                className="flex-1 rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm placeholder:text-muted-foreground"
                placeholder="Écrire un message"
                value={input}
                onChange={(e)=>setInput(e.target.value)}
                onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } }}
              />
              <Button onClick={send} className="w-full sm:w-auto">Envoyer</Button>
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
        </CardContent>
      </Card>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-24 right-6 rounded-full bg-blue-500 hover:bg-blue-600 text-white p-3 shadow-lg transition-all duration-200 z-50 animate-in fade-in slide-in-from-bottom-2"
          aria-label="Descendre en bas de la conversation"
        >
          <ArrowDown size={24} />
        </button>
      )}
    </div>
  );
}
