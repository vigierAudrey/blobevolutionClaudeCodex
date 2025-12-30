"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { apiClient } from '../lib/apiClient';
import { Button } from './ui/button';
import { X, Check } from 'lucide-react';

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
    loadInvitations();
    // Poll for new invitations every 30 seconds
    const interval = setInterval(loadInvitations, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      const data = await apiClient.getPendingConversationInvitations();
      setInvitations(data.items);
    } catch (err) {
      console.error('Error loading invitations:', err);
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
    } catch (err) {
      console.error('Error responding to invitation:', err);
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
        <div
          key={invitation.id}
          className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
        >
          {invitation.inviterPhotoUrl ? (
            <Image
              src={invitation.inviterPhotoUrl}
              alt={invitation.inviterName}
              width={40}
              height={40}
              className="rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
              {invitation.inviterName[0].toUpperCase()}
            </div>
          )}

          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              {invitation.inviterName} vous invite à rejoindre une conversation
            </div>
            <div className="text-xs text-muted-foreground">
              {invitation.memberCount} {invitation.memberCount > 1 ? 'membres' : 'membre'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => handleRespond(invitation.id, 'ACCEPT')}
              disabled={responding === invitation.id}
              className="flex items-center gap-1"
            >
              <Check size={14} />
              Accepter
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRespond(invitation.id, 'REJECT')}
              disabled={responding === invitation.id}
              className="flex items-center gap-1"
            >
              <X size={14} />
              Refuser
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
