'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSocket } from './useSocket';

export interface NewMatchNotification {
  matchId: string;
  conversationId?: string;
  otherUser: {
    id: string;
    displayName: string;
    photoUrl?: string | null;
  };
}

export interface MatchDecisionNotification {
  actorUserId: string;
  decision: 'ACCEPT' | 'DECLINE';
  mutualMatch: boolean;
  conversationId?: string;
}

interface NewMatchingCardNotification {
  sport: string;
  level: string;
  profileId: string;
}

interface UseMatchingOptions {
  token: string;
  onNewMatch?: (match: NewMatchNotification) => void;
  onMatchDecision?: (decision: MatchDecisionNotification) => void;
  onNewCard?: (card: NewMatchingCardNotification) => void;
  currentCriteria?: {
    sport?: string;
    level?: string;
  };
}

interface UseMatchingReturn {
  connected: boolean;
  newMatchesCount: number;
  latestMatch: NewMatchNotification | null;
  clearLatestMatch: () => void;
}

/**
 * Hook React pour gérer les événements de matching en temps réel
 *
 * @example
 * const { connected, newMatchesCount, latestMatch } = useMatching({
 *   token: accessToken,
 *   onNewMatch: (match) => {
 *     showToast(`Nouveau match avec ${match.otherUser.displayName}!`);
 *   },
 *   onNewCard: (card) => {
 *     // Recharger les cartes si le sport/level correspond
 *     if (card.sport === currentSport && card.level === currentLevel) {
 *       refreshCards();
 *     }
 *   }
 * });
 */
export function useMatching(options: UseMatchingOptions): UseMatchingReturn {
  const { token, onNewMatch, onMatchDecision, onNewCard, currentCriteria } = options;
  const { socket, connected, on, off } = useSocket({ token, autoConnect: true });

  const [newMatchesCount, setNewMatchesCount] = useState(0);
  const [latestMatch, setLatestMatch] = useState<NewMatchNotification | null>(null);

  // Écouter les nouveaux matches
  useEffect(() => {
    if (!socket) return;

    const handleNewMatch = (match: NewMatchNotification) => {
      console.log('[useMatching] New match received:', match);

      setNewMatchesCount(prev => prev + 1);
      setLatestMatch(match);

      if (onNewMatch) {
        onNewMatch(match);
      }
    };

    const handleMatchDecision = (decision: MatchDecisionNotification) => {
      console.log('[useMatching] Match decision received:', decision);

      if (onMatchDecision) {
        onMatchDecision(decision);
      }
    };

    const handleNewCard = (card: NewMatchingCardNotification) => {
      console.log('[useMatching] New matching card:', card);

      // Filtrer côté client : notifier seulement si ça correspond aux critères actuels
      if (currentCriteria) {
        const matchesCriteria =
          (!currentCriteria.sport || card.sport === currentCriteria.sport) &&
          (!currentCriteria.level || card.level === currentCriteria.level);

        if (!matchesCriteria) {
          return; // Ignorer cette notification
        }
      }

      if (onNewCard) {
        onNewCard(card);
      }
    };

    on('new-match', handleNewMatch);
    on('match-decision', handleMatchDecision);
    on('new-matching-card', handleNewCard);

    return () => {
      off('new-match', handleNewMatch);
      off('match-decision', handleMatchDecision);
      off('new-matching-card', handleNewCard);
    };
  }, [socket, on, off, onNewMatch, onMatchDecision, onNewCard, currentCriteria]);

  const clearLatestMatch = useCallback(() => {
    setLatestMatch(null);
  }, []);

  return {
    connected,
    newMatchesCount,
    latestMatch,
    clearLatestMatch
  };
}
