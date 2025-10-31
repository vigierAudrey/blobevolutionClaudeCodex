/**
 * Tests pour les utilitaires du système de matching
 */

import { formatDateForDisplay } from '../utils';

describe('Utilitaires de formatage des dates', () => {
  beforeEach(() => {
    // Mock la date pour avoir des tests déterministes
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('devrait retourner "—" pour une date null', () => {
    expect(formatDateForDisplay(null)).toBe('—');
  });

  it('devrait retourner "—" pour une chaîne vide', () => {
    expect(formatDateForDisplay('')).toBe('—');
  });

  it('devrait retourner "Peu importe" pour "anytime"', () => {
    expect(formatDateForDisplay('anytime')).toBe('Peu importe');
  });

  it('devrait retourner "Aujourd\'hui" pour la date actuelle', () => {
    const today = '2024-01-15';
    expect(formatDateForDisplay(today)).toBe("Aujourd'hui");
  });

  it('devrait retourner "Demain" pour le lendemain', () => {
    const tomorrow = '2024-01-16';
    expect(formatDateForDisplay(tomorrow)).toBe('Demain');
  });

  it('devrait formater correctement une date future', () => {
    const futureDate = '2024-01-20';
    const result = formatDateForDisplay(futureDate);
    expect(result).toMatch(/sam\. 20 janv\./);
  });

  it('devrait formater correctement une date passée', () => {
    const pastDate = '2024-01-10';
    const result = formatDateForDisplay(pastDate);
    expect(result).toMatch(/mer\. 10 janv\./);
  });

  it('devrait gérer les dates invalides en retournant la chaîne originale', () => {
    const invalidDate = 'invalid-date';
    expect(formatDateForDisplay(invalidDate)).toBe('invalid-date');
  });

  it('devrait gérer les changements de mois', () => {
    const nextMonth = '2024-02-15';
    const result = formatDateForDisplay(nextMonth);
    expect(result).toMatch(/jeu\. 15 févr\./);
  });

  it('devrait gérer les changements d\'année', () => {
    const nextYear = '2025-01-15';
    const result = formatDateForDisplay(nextYear);
    expect(result).toMatch(/mer\. 15 janv\./);
  });
});

describe('Logique de gestion de la queue des décisions', () => {
  interface QueuedDecision {
    targetProfileId: string;
    decision: 'ACCEPT' | 'REFUSE';
    ts: number;
  }

  // Simulation de la logique de flush des décisions
  function getDecisionsDue(queue: QueuedDecision[], currentTime: number, delayMs: number = 5000): QueuedDecision[] {
    return queue.filter(d => currentTime - d.ts >= delayMs);
  }

  function getDecisionsPending(queue: QueuedDecision[], currentTime: number, delayMs: number = 5000): QueuedDecision[] {
    return queue.filter(d => currentTime - d.ts < delayMs);
  }

  it('devrait identifier les décisions prêtes à être envoyées', () => {
    const currentTime = Date.now();
    const queue: QueuedDecision[] = [
      { targetProfileId: 'profile-1', decision: 'ACCEPT', ts: currentTime - 6000 }, // Prête
      { targetProfileId: 'profile-2', decision: 'REFUSE', ts: currentTime - 3000 }, // Pas prête
      { targetProfileId: 'profile-3', decision: 'ACCEPT', ts: currentTime - 7000 }, // Prête
    ];

    const due = getDecisionsDue(queue, currentTime);
    const pending = getDecisionsPending(queue, currentTime);

    expect(due).toHaveLength(2);
    expect(due[0].targetProfileId).toBe('profile-1');
    expect(due[1].targetProfileId).toBe('profile-3');

    expect(pending).toHaveLength(1);
    expect(pending[0].targetProfileId).toBe('profile-2');
  });

  it('devrait gérer une queue vide', () => {
    const currentTime = Date.now();
    const queue: QueuedDecision[] = [];

    const due = getDecisionsDue(queue, currentTime);
    const pending = getDecisionsPending(queue, currentTime);

    expect(due).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('devrait respecter le délai personnalisé', () => {
    const currentTime = Date.now();
    const customDelay = 3000;
    const queue: QueuedDecision[] = [
      { targetProfileId: 'profile-1', decision: 'ACCEPT', ts: currentTime - 4000 }, // Prête avec délai de 3s
      { targetProfileId: 'profile-2', decision: 'REFUSE', ts: currentTime - 2000 }, // Pas prête avec délai de 3s
    ];

    const due = getDecisionsDue(queue, currentTime, customDelay);
    const pending = getDecisionsPending(queue, currentTime, customDelay);

    expect(due).toHaveLength(1);
    expect(due[0].targetProfileId).toBe('profile-1');

    expect(pending).toHaveLength(1);
    expect(pending[0].targetProfileId).toBe('profile-2');
  });
});

describe('Logique de pagination et de préchargement', () => {
  interface Profile {
    id: string;
    displayName: string;
  }

  // Simulation de la logique de préchargement
  function shouldPrefetch(cursor: number, totalCandidates: number, threshold: number = 3): boolean {
    const remaining = totalCandidates - cursor - 1;
    return remaining <= threshold && totalCandidates > 0;
  }

  // Simulation de la déduplication des profils
  function deduplicateProfiles(existing: Profile[], incoming: Profile[]): Profile[] {
    const existingIds = new Set(existing.map(p => p.id));
    return incoming.filter(p => !existingIds.has(p.id));
  }

  // Simulation de la gestion des IDs exclus
  function manageExcludedIds(current: string[], newIds: string[], maxSize: number = 200): string[] {
    const combined = Array.from(new Set([...current, ...newIds]));
    return combined.slice(-maxSize);
  }

  it('devrait déclencher le préchargement quand proche de la fin', () => {
    expect(shouldPrefetch(7, 10, 3)).toBe(true); // Reste 2 profils
    expect(shouldPrefetch(6, 10, 3)).toBe(true); // Reste 3 profils
    expect(shouldPrefetch(5, 10, 3)).toBe(false); // Reste 4 profils
  });

  it('ne devrait pas précharger si la liste est vide', () => {
    expect(shouldPrefetch(0, 0, 3)).toBe(false);
  });

  it('devrait correctement dédupliquer les profils', () => {
    const existing: Profile[] = [
      { id: 'profile-1', displayName: 'User 1' },
      { id: 'profile-2', displayName: 'User 2' },
    ];

    const incoming: Profile[] = [
      { id: 'profile-2', displayName: 'User 2' }, // Doublon
      { id: 'profile-3', displayName: 'User 3' }, // Nouveau
      { id: 'profile-4', displayName: 'User 4' }, // Nouveau
    ];

    const deduplicated = deduplicateProfiles(existing, incoming);

    expect(deduplicated).toHaveLength(2);
    expect(deduplicated.map(p => p.id)).toEqual(['profile-3', 'profile-4']);
  });

  it('devrait gérer la taille maximale des IDs exclus', () => {
    const current = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const newIds = Array.from({ length: 100 }, (_, i) => `new-${i}`);

    const managed = manageExcludedIds(current, newIds, 200);

    expect(managed).toHaveLength(200);
    // Vérifier que les nouveaux IDs sont présents
    expect(managed.slice(-100)).toEqual(newIds);
    // Vérifier que la taille est respectée
    expect(managed.length).toBeLessThanOrEqual(200);
  });

  it('devrait éliminer les doublons dans les IDs exclus', () => {
    const current = ['id-1', 'id-2', 'id-3'];
    const newIds = ['id-2', 'id-3', 'id-4']; // Avec doublons

    const managed = manageExcludedIds(current, newIds, 200);

    expect(managed).toEqual(['id-1', 'id-2', 'id-3', 'id-4']);
  });
});

describe('Validation des paramètres de recherche', () => {
  function validateSearchParams(params: {
    sport?: string | null;
    level?: string | null;
    date?: string | null;
    lat?: string | null;
    lng?: string | null;
    distanceKm?: string | null;
  }): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!params.sport || !['surf', 'kitesurf'].includes(params.sport)) {
      errors.push('Sport invalide ou manquant');
    }

    if (!params.level || !['beginner', 'intermediate', 'advanced'].includes(params.level)) {
      errors.push('Niveau invalide ou manquant');
    }

    if (!params.date) {
      errors.push('Date manquante');
    } else if (params.date !== 'anytime') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(params.date)) {
        errors.push('Format de date invalide');
      }
    }

    if (params.lat && params.lng) {
      const lat = parseFloat(params.lat);
      const lng = parseFloat(params.lng);

      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.push('Latitude invalide');
      }

      if (isNaN(lng) || lng < -180 || lng > 180) {
        errors.push('Longitude invalide');
      }
    }

    if (params.distanceKm) {
      const distance = parseInt(params.distanceKm, 10);
      if (isNaN(distance) || distance < 1 || distance > 500) {
        errors.push('Distance invalide');
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  it('devrait valider des paramètres corrects', () => {
    const validParams = {
      sport: 'surf',
      level: 'intermediate',
      date: '2024-01-15',
      lat: '43.4832',
      lng: '-1.5586',
      distanceKm: '20',
    };

    const result = validateSearchParams(validParams);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('devrait accepter "anytime" comme date valide', () => {
    const params = {
      sport: 'kitesurf',
      level: 'advanced',
      date: 'anytime',
    };

    const result = validateSearchParams(params);
    expect(result.isValid).toBe(true);
  });

  it('devrait rejeter des sports invalides', () => {
    const params = {
      sport: 'snowboard',
      level: 'intermediate',
      date: '2024-01-15',
    };

    const result = validateSearchParams(params);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Sport invalide ou manquant');
  });

  it('devrait rejeter des niveaux invalides', () => {
    const params = {
      sport: 'surf',
      level: 'expert',
      date: '2024-01-15',
    };

    const result = validateSearchParams(params);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Niveau invalide ou manquant');
  });

  it('devrait rejeter des formats de date invalides', () => {
    const params = {
      sport: 'surf',
      level: 'beginner',
      date: '15-01-2024', // Format incorrect
    };

    const result = validateSearchParams(params);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Format de date invalide');
  });

  it('devrait rejeter des coordonnées invalides', () => {
    const params = {
      sport: 'surf',
      level: 'intermediate',
      date: '2024-01-15',
      lat: '95', // > 90
      lng: '-200', // < -180
    };

    const result = validateSearchParams(params);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Latitude invalide');
    expect(result.errors).toContain('Longitude invalide');
  });

  it('devrait rejeter des distances invalides', () => {
    const params = {
      sport: 'surf',
      level: 'intermediate',
      date: '2024-01-15',
      distanceKm: '1000', // > 500
    };

    const result = validateSearchParams(params);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Distance invalide');
  });

  it('devrait gérer des paramètres manquants', () => {
    const params = {};

    const result = validateSearchParams(params);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Sport invalide ou manquant');
    expect(result.errors).toContain('Niveau invalide ou manquant');
    expect(result.errors).toContain('Date manquante');
  });
});
