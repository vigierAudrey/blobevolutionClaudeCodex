"use client";

import { useState, useEffect } from 'react';
import { apiClient } from '../lib/apiClient';
import { X, Check } from 'lucide-react';
import { BlobButton, BlobCard } from './blob';
import { ProfilePhoto } from './media/ProfilePhoto';

interface ConversationInvitation {
  id: string;
  conversationId: string;
  inviterName: string;
  inviterPhotoUrl: string | null;
  memberCount: number;
  createdAt: string;
}

export function ConversationInvitations() {
  const [invitations, setInvitations] = useState<ConversationInvitation[]>([]);
  const [, setLoading] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);

  useEffect(() => {
    void loadInvitations();
    let interval: number | null = null;
    const start = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      if (interval != null) window.clearInterval(interval);
      interval = window.setInterval(() => void loadInvitations(), 30000);
    };
    const stop = () => {
      if (interval != null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadInvitations();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getPendingConversationInvitations();
      setInvitations(data.items);
    } catch {
      // Non-critical: retried on the next visible poll.
    } finally {
      setLoading(false);
    }
  };

  const handleRespond = async (invitationId: string, action: 'ACCEPT' | 'REJECT') => {
    if (responding) return;

    setResponding(invitationId);
    try {
      await apiClient.respondToConversationInvitation(invitationId, action);

      // Remove the invitation from the list
      setInvitations(prev => prev.filter(inv => inv.id !== invitationId));

      if (action === 'ACCEPT') {
        // Optionally redirect to the conversation
        // window.location.href = `/messages/${invitation.conversationId}`;
      }
    } catch {
      alert('Erreur lors de la réponse à l\'invitation');
    } finally {
      setResponding(null);
    }
  };

  if (invitations.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 space-y-2">
      {invitations.map((invitation) => (
        <BlobCard
          key={invitation.id}
          className="bg-white"
        >
          <div className="flex items-center gap-3">
            {invitation.inviterPhotoUrl ? (
              <ProfilePhoto
                src={invitation.inviterPhotoUrl}
                alt={invitation.inviterName}
                width={40}
                height={40}
                className="rounded-sm border-2 border-blob-black dark:border-white/30 object-cover"
                fallbackClassName="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black dark:border-white/30 bg-blob-sand dark:bg-[hsl(220_14%_18%)] px-1 text-center text-[8px] text-blob-black/60 dark:text-white/60"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black dark:border-white/30 bg-blob-sand dark:bg-[hsl(220_14%_18%)] font-black text-blob-black dark:text-white">
                {invitation.inviterName[0].toUpperCase()}
              </div>
            )}

            <div className="flex-1">
              <div className="text-sm font-black uppercase tracking-[0.08em] text-blob-black dark:text-white">
                {invitation.inviterName} vous invite à rejoindre une conversation
              </div>
              <div className="text-xs text-blob-black/56 dark:text-white/55">
                {invitation.memberCount} {invitation.memberCount > 1 ? 'membres' : 'membre'}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <BlobButton
                variant="dark"
                size="sm"
                onClick={() => handleRespond(invitation.id, 'ACCEPT')}
                disabled={responding === invitation.id}
              >
                <Check size={14} />
                Accepter
              </BlobButton>
              <BlobButton
                variant="outlineDark"
                size="sm"
                onClick={() => handleRespond(invitation.id, 'REJECT')}
                disabled={responding === invitation.id}
              >
                <X size={14} />
                Refuser
              </BlobButton>
            </div>
          </div>
        </BlobCard>
      ))}
    </div>
  );
}
