"use client";

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { apiClient } from '../lib/apiClient';
import { UserPlus, X, Search, UserMinus, LogOut } from 'lucide-react';
import { BlobButton } from './blob';

interface ConversationMembersProps {
  conversationId: string;
  onMemberAdded?: () => void;
  onMemberRemoved?: () => void;
}

interface UserSearchResult {
  id: string;
  name: string | null;
  photoUrl: string | null;
  role: 'RIDER' | 'PRO';
}

interface ConversationMember {
  id: string;
  name: string | null;
  photoUrl: string | null;
  role: string;
  isCurrentUser: boolean;
}

export function ConversationMembers({ conversationId, onMemberAdded, onMemberRemoved }: ConversationMembersProps) {
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const data = await apiClient.getConversationMembers(conversationId);
      setMembers(data.items);
    } catch {
      // Members are optional metadata for the conversation view.
    } finally {
      setLoadingMembers(false);
    }
  }, [conversationId]);

  // Load members on mount
  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // Search users when query changes
  useEffect(() => {
    const searchUsers = async () => {
      if (searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const data = await apiClient.searchUsers(searchQuery.trim());
        setSearchResults(data.items);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    };

    // Debounce search
    const timer = setTimeout(searchUsers, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleAddMember = async (userId: string) => {
    if (adding) return;

    setAdding(true);
    try {
      await apiClient.addConversationMember(conversationId, userId);
      setShowAddMember(false);
      setSearchQuery('');
      setSearchResults([]);
      alert('✓ Invitation envoyée ! L\'utilisateur pourra accepter ou refuser votre invitation.');
      await loadMembers();
      onMemberAdded?.();
    } catch {
      alert('Impossible d\'envoyer cette invitation pour le moment');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = async (userId: string, isCurrentUser: boolean) => {
    if (removing) return;

    const confirmMessage = isCurrentUser
      ? 'Voulez-vous quitter cette conversation ?'
      : 'Voulez-vous retirer ce membre de la conversation ?';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setRemoving(userId);
    try {
      await apiClient.removeConversationMember(conversationId, userId);
      await loadMembers();
      onMemberRemoved?.();
    } catch {
      alert('Erreur lors de la suppression du membre');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="mt-3 border-t-2 border-blob-sand-deep pt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-black uppercase tracking-widest text-blob-black">
          Membres ({members.length})
        </h3>
        <BlobButton
          variant="outlineDark"
          size="sm"
          onClick={() => setShowAddMember(!showAddMember)}
        >
          {showAddMember ? (
            <>
              <X size={14} />
              Annuler
            </>
          ) : (
            <>
              <UserPlus size={14} />
              Ajouter
            </>
          )}
        </BlobButton>
      </div>

      {/* Current members list */}
      {loadingMembers ? (
        <p className="py-2 text-xs text-blob-black/56">Chargement des membres...</p>
      ) : (
        <div className="space-y-1 mb-3">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-2 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-2"
            >
              {member.photoUrl ? (
                <Image
                  src={member.photoUrl}
                  alt={member.name || 'User'}
                  width={32}
                  height={32}
                  className="rounded-sm border-2 border-blob-black object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-sm border-2 border-blob-black bg-white text-xs font-black text-blob-black">
                  {(member.name || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <div className="text-sm font-medium text-blob-black">
                  {member.name || 'Utilisateur'}
                  {member.isCurrentUser && (
                    <span className="ml-1 text-xs text-blob-black/56">(vous)</span>
                  )}
                </div>
                <div className="text-xs text-blob-black/56">
                  {member.role === 'PRO' ? 'Professionnel' : 'Rider'}
                </div>
              </div>
              <BlobButton
                variant="outlineDark"
                size="sm"
                onClick={() => handleRemoveMember(member.id, member.isCurrentUser)}
                disabled={removing === member.id}
                className="border-red-800 text-red-800 hover:bg-red-50"
                title={member.isCurrentUser ? 'Quitter la conversation' : 'Retirer ce membre'}
              >
                {member.isCurrentUser ? (
                  <LogOut size={14} />
                ) : (
                  <UserMinus size={14} />
                )}
              </BlobButton>
            </div>
          ))}
        </div>
      )}

      {showAddMember && (
        <div className="mb-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3">
          <div className="relative mb-2">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-blob-black/56">
              <Search size={16} />
            </div>
            <input
              type="text"
              className="w-full rounded-sm border-2 border-blob-black bg-white py-2 pl-9 pr-3 text-sm text-blob-black placeholder:text-blob-black/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
              placeholder="Rechercher par nom..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          {searching && (
            <p className="py-2 text-xs text-blob-black/56">Recherche...</p>
          )}

          {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <p className="py-2 text-xs text-blob-black/56">Aucun utilisateur trouvé</p>
          )}

          {searchResults.length > 0 && (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleAddMember(user.id)}
                  disabled={adding}
                  className="flex w-full items-center gap-2 rounded-sm border-2 border-transparent p-2 transition-colors hover:border-blob-black hover:bg-white disabled:opacity-50"
                >
                  {user.photoUrl ? (
                    <Image
                      src={user.photoUrl}
                      alt={user.name || 'User'}
                      width={32}
                      height={32}
                      className="rounded-sm border-2 border-blob-black object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-sm border-2 border-blob-black bg-white text-xs font-black text-blob-black">
                      {(user.name || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-blob-black">
                      {user.name || 'Utilisateur'}
                    </div>
                    <div className="text-xs text-blob-black/56">
                      {user.role === 'PRO' ? 'Professionnel' : 'Rider'}
                    </div>
                  </div>
                  <UserPlus size={16} className="text-blob-black/56" />
                </button>
              ))}
            </div>
          )}

          {searchQuery.trim().length < 2 && (
            <p className="py-2 text-xs text-blob-black/56">
              Entrez au moins 2 caractères pour rechercher
            </p>
          )}
        </div>
      )}
    </div>
  );
}
