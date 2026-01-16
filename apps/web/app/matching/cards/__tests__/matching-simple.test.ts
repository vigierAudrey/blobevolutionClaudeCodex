/**
 * Tests simples pour les fonctionnalités de matching
 */

import { formatDateForDisplay } from '../utils';

// Tests fonctionnels pour les composants matching
describe('Matching Cards - Tests fonctionnels', () => {
  describe('Formatage des dates', () => {
    beforeAll(() => {
      // Mock la date pour des tests déterministes
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    test('formate correctement les dates spéciales', () => {
      expect(formatDateForDisplay(null)).toBe('—');
      expect(formatDateForDisplay('')).toBe('—');
      expect(formatDateForDisplay('anytime')).toBe('Peu importe');
      expect(formatDateForDisplay('2024-01-15')).toBe("Aujourd'hui");
      expect(formatDateForDisplay('2024-01-16')).toBe('Demain');
    });

    test('gère les dates invalides', () => {
      expect(formatDateForDisplay('invalid-date')).toBe('invalid-date');
      expect(formatDateForDisplay('2024-13-45')).toBe('2024-13-45');
    });

    test('formate correctement les dates normales', () => {
      const result = formatDateForDisplay('2024-01-20');
      expect(result).toMatch(/sam/); // Samedi
    });
  });

  describe('Logique de swipe et décisions', () => {
    interface QueuedDecision {
      targetProfileId: string;
      decision: 'ACCEPT' | 'REFUSE';
      ts: number;
    }

    function getDecisionsDue(queue: QueuedDecision[], currentTime: number, delayMs: number = 5000): QueuedDecision[] {
      return queue.filter(d => currentTime - d.ts >= delayMs);
    }

    function shouldPrefetch(cursor: number, totalCandidates: number, threshold: number = 3): boolean {
      const remaining = totalCandidates - cursor - 1;
      return remaining <= threshold && totalCandidates > 0;
    }

    test('identifie correctement les décisions prêtes', () => {
      const currentTime = Date.now();
      const queue: QueuedDecision[] = [
        { targetProfileId: 'profile-1', decision: 'ACCEPT', ts: currentTime - 6000 },
        { targetProfileId: 'profile-2', decision: 'REFUSE', ts: currentTime - 3000 },
      ];

      const due = getDecisionsDue(queue, currentTime);
      expect(due).toHaveLength(1);
      expect(due[0].targetProfileId).toBe('profile-1');
    });

    test('détermine correctement quand précharger', () => {
      expect(shouldPrefetch(7, 10, 3)).toBe(true); // Reste 2 profils
      expect(shouldPrefetch(5, 10, 3)).toBe(false); // Reste 4 profils
      expect(shouldPrefetch(0, 0, 3)).toBe(false); // Liste vide
    });
  });

  describe('Validation des paramètres de recherche', () => {
    function validateSport(sport: string): boolean {
      return ['surf', 'kitesurf'].includes(sport);
    }

    function validateLevel(level: string): boolean {
      return ['beginner', 'intermediate', 'advanced'].includes(level);
    }

    function validateCoordinates(lat: number, lng: number): { lat: boolean; lng: boolean } {
      return {
        lat: lat >= -90 && lat <= 90,
        lng: lng >= -180 && lng <= 180,
      };
    }

    test('valide correctement les sports', () => {
      expect(validateSport('surf')).toBe(true);
      expect(validateSport('kitesurf')).toBe(true);
      expect(validateSport('snowboard')).toBe(false);
      expect(validateSport('')).toBe(false);
    });

    test('valide correctement les niveaux', () => {
      expect(validateLevel('beginner')).toBe(true);
      expect(validateLevel('intermediate')).toBe(true);
      expect(validateLevel('advanced')).toBe(true);
      expect(validateLevel('expert')).toBe(false);
    });

    test('valide correctement les coordonnées', () => {
      expect(validateCoordinates(43.4832, -1.5586)).toEqual({ lat: true, lng: true });
      expect(validateCoordinates(91, -1.5586)).toEqual({ lat: false, lng: true });
      expect(validateCoordinates(43.4832, 181)).toEqual({ lat: true, lng: false });
    });
  });

  describe('Gestion de la pagination et des profils', () => {
    interface Profile {
      id: string;
      displayName: string;
      sport: string;
      level: string;
    }

    function deduplicateProfiles(existing: Profile[], incoming: Profile[]): Profile[] {
      const existingIds = new Set(existing.map(p => p.id));
      return incoming.filter(p => !existingIds.has(p.id));
    }

    function manageExcludedIds(current: string[], newIds: string[], maxSize: number = 200): string[] {
      const combined = Array.from(new Set([...current, ...newIds]));
      return combined.slice(-maxSize);
    }

    test('déduplique correctement les profils', () => {
      const existing: Profile[] = [
        { id: 'profile-1', displayName: 'User 1', sport: 'surf', level: 'beginner' },
        { id: 'profile-2', displayName: 'User 2', sport: 'kitesurf', level: 'intermediate' },
      ];

      const incoming: Profile[] = [
        { id: 'profile-2', displayName: 'User 2', sport: 'kitesurf', level: 'intermediate' }, // Doublon
        { id: 'profile-3', displayName: 'User 3', sport: 'surf', level: 'advanced' }, // Nouveau
      ];

      const deduplicated = deduplicateProfiles(existing, incoming);
      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0].id).toBe('profile-3');
    });

    test('gère correctement la taille des IDs exclus', () => {
      const current = ['id-1', 'id-2'];
      const newIds = ['id-3', 'id-4'];
      const managed = manageExcludedIds(current, newIds, 10);

      expect(managed).toContain('id-1');
      expect(managed).toContain('id-2');
      expect(managed).toContain('id-3');
      expect(managed).toContain('id-4');
      expect(managed.length).toBeLessThanOrEqual(10);
    });

    test('élimine les doublons dans les IDs exclus', () => {
      const current = ['id-1', 'id-2'];
      const newIds = ['id-2', 'id-3']; // id-2 est un doublon
      const managed = manageExcludedIds(current, newIds);

      expect(managed).toEqual(['id-1', 'id-2', 'id-3']);
    });
  });

  describe('Animations et interactions UI', () => {
    type AnimationDirection = 'left' | 'right' | null;

    function getAnimationClass(direction: AnimationDirection): string {
      switch (direction) {
        case 'left':
          return '-translate-x-24 opacity-0';
        case 'right':
          return 'translate-x-24 opacity-0';
        default:
          return '';
      }
    }

    function determineAnimationDirection(decision: 'ACCEPT' | 'REFUSE'): AnimationDirection {
      return decision === 'REFUSE' ? 'left' : 'right';
    }

    test('détermine correctement la direction d\'animation', () => {
      expect(determineAnimationDirection('ACCEPT')).toBe('right');
      expect(determineAnimationDirection('REFUSE')).toBe('left');
    });

    test('génère les bonnes classes CSS d\'animation', () => {
      expect(getAnimationClass('left')).toBe('-translate-x-24 opacity-0');
      expect(getAnimationClass('right')).toBe('translate-x-24 opacity-0');
      expect(getAnimationClass(null)).toBe('');
    });
  });

  describe('Gestion des matches et conversations', () => {
    interface MatchResult {
      conversationId: string;
      otherDisplayName: string;
    }

    function processMatchResult(result: { createdConversations?: MatchResult[] }): MatchResult | null {
      if (result.createdConversations && result.createdConversations.length > 0) {
        return result.createdConversations[0];
      }
      return null;
    }

    function formatMatchMessage(otherName: string, sport: 'surf' | 'kitesurf'): string {
      const activity = sport === 'surf' ? 'surfer' : 'kiter';
      return `Tu vas pouvoir ${activity} avec ${otherName}`;
    }

    test('traite correctement les résultats de match', () => {
      const resultWithMatch = {
        createdConversations: [
          { conversationId: 'conv-123', otherDisplayName: 'Surf Buddy' }
        ]
      };
      const resultWithoutMatch = { createdConversations: [] };

      expect(processMatchResult(resultWithMatch)).toEqual({
        conversationId: 'conv-123',
        otherDisplayName: 'Surf Buddy'
      });
      expect(processMatchResult(resultWithoutMatch)).toBeNull();
    });

    test('formate correctement les messages de match', () => {
      expect(formatMatchMessage('Alice', 'surf')).toBe('Tu vas pouvoir surfer avec Alice');
      expect(formatMatchMessage('Bob', 'kitesurf')).toBe('Tu vas pouvoir kiter avec Bob');
    });
  });

  describe('Performance et optimisations', () => {
    function batchDecisions<T>(items: T[], batchSize: number): T[][] {
      const batches: T[][] = [];
      for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
      }
      return batches;
    }

    function debounce<T extends (...args: never[]) => unknown>(
      func: T,
      delay: number
    ): (...args: Parameters<T>) => void {
      let timeoutId: NodeJS.Timeout;
      return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
      };
    }

    test('divise correctement les éléments en batches', () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const batches = batchDecisions(items, 10);

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(10);
      expect(batches[1]).toHaveLength(10);
      expect(batches[2]).toHaveLength(5);
    });

    test('implémente correctement le debouncing', (done) => {
      const mockFn = jest.fn();
      const debouncedFn = debounce(mockFn, 100);

      debouncedFn('test1');
      debouncedFn('test2');
      debouncedFn('test3');

      expect(mockFn).not.toHaveBeenCalled();

      setTimeout(() => {
        expect(mockFn).toHaveBeenCalledTimes(1);
        expect(mockFn).toHaveBeenCalledWith('test3');
        done();
      }, 150);
    });
  });
});