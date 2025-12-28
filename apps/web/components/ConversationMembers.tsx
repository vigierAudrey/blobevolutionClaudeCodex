"use client";

import { useState, useEffect } from 'react';
import { apiClient } from '../lib/apiClient';
import { Button } from './ui/button';
import { UserPlus, X, Search, UserMinus, LogOut } from 'lucide-react';

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

  // Load members on mount
  useEffect(() => {
    loadMembers();
  }, [conversationId]);

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const data = await apiClient.getConversationMembers(conversationId);
      setMembers(data.items);
    } catch (err) {
      console.error('Error loading members:', err);
    } finally {
      setLoadingMembers(false);
    }
  };

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
      } catch (err) {
        console.error('Error searching users:', err);
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
      await loadMembers();
      onMemberAdded?.();
    } catch (err: any) {
      if (err?.message?.includes('already a member')) {
        alert('Cet utilisateur est déjà membre de la conversation');
      } else {
        alert('Erreur lors de l\'ajout du membre');
      }
      console.error('Error adding member:', err);
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
    } catch (err) {
      alert('Erreur lors de la suppression du membre');
      console.error('Error removing member:', err);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="border-t pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground">
          Membres ({members.length})
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddMember(!showAddMember)}
          className="flex items-center gap-1"
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
        </Button>
      </div>

      {/* Current members list */}
      {loadingMembers ? (
        <p className="text-xs text-muted-foreground py-2">Chargement des membres...</p>
      ) : (
        <div className="space-y-1 mb-3">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-2 p-2 rounded-md bg-accent border border-border"
            >
              {member.photoUrl ? (
                <img
                  src={member.photoUrl}
                  alt={member.name || 'User'}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  {(member.name || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">
                  {member.name || 'Utilisateur'}
                  {member.isCurrentUser && (
                    <span className="ml-1 text-xs text-muted-foreground">(vous)</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {member.role === 'PRO' ? 'Professionnel' : 'Rider'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveMember(member.id, member.isCurrentUser)}
                disabled={removing === member.id}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                title={member.isCurrentUser ? 'Quitter la conversation' : 'Retirer ce membre'}
              >
                {member.isCurrentUser ? (
                  <LogOut size={14} />
                ) : (
                  <UserMinus size={14} />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {showAddMember && (
        <div className="mb-3 p-3 bg-accent rounded-lg border border-border">
          <div className="relative mb-2">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <Search size={16} />
            </div>
            <input
              type="text"
              className="w-full pl-9 pr-3 py-2 rounded-md border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground"
              placeholder="Rechercher par nom..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          {searching && (
            <p className="text-xs text-muted-foreground py-2">Recherche...</p>
          )}

          {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">Aucun utilisateur trouvé</p>
          )}

          {searchResults.length > 0 && (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {searchResults.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleAddMember(user.id)}
                  disabled={adding}
                  className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-background border border-transparent hover:border-border transition-colors disabled:opacity-50"
                >
                  {user.photoUrl ? (
                    <img
                      src={user.photoUrl}
                      alt={user.name || 'User'}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                      {(user.name || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-foreground">
                      {user.name || 'Utilisateur'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {user.role === 'PRO' ? 'Professionnel' : 'Rider'}
                    </div>
                  </div>
                  <UserPlus size={16} className="text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {searchQuery.trim().length < 2 && (
            <p className="text-xs text-muted-foreground py-2">
              Entrez au moins 2 caractères pour rechercher
            </p>
          )}
        </div>
      )}
    </div>
  );
}
