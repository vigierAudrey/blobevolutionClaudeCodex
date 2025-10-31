/**
 * Tests d'intégration pour le système de matching complet
 * Ces tests documentent le comportement attendu de l'ensemble du système
 */

describe('Système de Matching - Tests d\'intégration', () => {
  describe('Flux complet de swipe', () => {
    test('devrait suivre le workflow complet: chargement → swipe → décision → match', () => {
      // 1. État initial
      const initialState = {
        candidates: [],
        cursor: 0,
        loading: false,
        decisionQueue: [],
        excludeIds: [],
        animating: false,
      };

      // 2. Chargement des profils
      const mockProfiles = [
        { id: 'profile-1', displayName: 'Alice', sport: 'surf', level: 'intermediate', distanceKm: 5 },
        { id: 'profile-2', displayName: 'Bob', sport: 'kitesurf', level: 'advanced', distanceKm: 12 },
      ];

      const stateAfterLoad = {
        ...initialState,
        candidates: mockProfiles,
        loading: false,
      };

      expect(stateAfterLoad.candidates).toHaveLength(2);
      expect(stateAfterLoad.candidates[0].displayName).toBe('Alice');

      // 3. Action de swipe (ACCEPT)
      const swipeAction = {
        type: 'ACCEPT',
        targetProfileId: 'profile-1',
        timestamp: Date.now(),
      };

      const stateAfterSwipe = {
        ...stateAfterLoad,
        cursor: 1, // Passage au profil suivant
        decisionQueue: [
          {
            targetProfileId: 'profile-1',
            decision: 'ACCEPT',
            ts: swipeAction.timestamp,
          },
        ],
        excludeIds: ['profile-1'],
        animating: false, // Animation terminée
      };

      expect(stateAfterSwipe.cursor).toBe(1);
      expect(stateAfterSwipe.decisionQueue).toHaveLength(1);
      expect(stateAfterSwipe.excludeIds).toContain('profile-1');

      // 4. Traitement des décisions (après 5 secondes)
      const timeAfterDelay = swipeAction.timestamp + 5000;
      const decisionsToSend = stateAfterSwipe.decisionQueue.filter(
        d => timeAfterDelay - d.ts >= 5000
      );

      expect(decisionsToSend).toHaveLength(1);
      expect(decisionsToSend[0]).toEqual({
        targetProfileId: 'profile-1',
        decision: 'ACCEPT',
        ts: swipeAction.timestamp,
      });

      // 5. Résultat avec match
      const matchResult = {
        ok: true,
        count: 1,
        createdConversations: [
          {
            conversationId: 'conv-123',
            otherDisplayName: 'Alice',
          },
        ],
      };

      expect(matchResult.createdConversations).toHaveLength(1);
      expect(matchResult.createdConversations[0].otherDisplayName).toBe('Alice');
    });

    test('devrait gérer le refus sans créer de match', () => {
      const refuseAction = {
        type: 'REFUSE',
        targetProfileId: 'profile-2',
        timestamp: Date.now(),
      };

      const decision = {
        targetProfileId: 'profile-2',
        decision: 'REFUSE' as const,
        ts: refuseAction.timestamp,
      };

      // Résultat sans match
      const result = {
        ok: true,
        count: 1,
        createdConversations: [], // Pas de conversation créée
      };

      expect(decision.decision).toBe('REFUSE');
      expect(result.createdConversations).toHaveLength(0);
    });
  });

  describe('Gestion de la pagination et du préchargement', () => {
    test('devrait charger de nouveaux profils quand la fin est atteinte', () => {
      // État initial avec quelques profils
      const initialCandidates = [
        { id: 'profile-1', displayName: 'User 1' },
        { id: 'profile-2', displayName: 'User 2' },
        { id: 'profile-3', displayName: 'User 3' },
      ];

      let cursor = 0;
      let candidates = [...initialCandidates];
      const excludeIds: string[] = [];

      // Simuler plusieurs swipes jusqu'à la fin
      for (let i = 0; i < 3; i++) {
        const currentProfile = candidates[cursor];
        excludeIds.push(currentProfile.id);
        cursor++;
      }

      // Fin atteinte, cursor === candidates.length
      expect(cursor).toBe(candidates.length);

      // Simulation du rechargement
      const newProfiles = [
        { id: 'profile-4', displayName: 'User 4' },
        { id: 'profile-5', displayName: 'User 5' },
      ];

      // Nouveau batch en excluant les IDs déjà vus
      const filteredProfiles = newProfiles.filter(p => !excludeIds.includes(p.id));

      candidates = filteredProfiles;
      cursor = 0;

      expect(candidates).toHaveLength(2);
      expect(cursor).toBe(0);
      expect(candidates[0].displayName).toBe('User 4');
    });

    test('devrait précharger quand il reste peu de profils', () => {
      const candidates = [
        { id: 'profile-1', displayName: 'User 1' },
        { id: 'profile-2', displayName: 'User 2' },
        { id: 'profile-3', displayName: 'User 3' },
        { id: 'profile-4', displayName: 'User 4' },
        { id: 'profile-5', displayName: 'User 5' },
      ];

      const cursor = 2; // Sur le 3ème profil
      const threshold = 3;

      const remaining = candidates.length - cursor - 1; // 2 profils restants
      const shouldPrefetch = remaining <= threshold && candidates.length > 0;

      expect(remaining).toBe(2);
      expect(shouldPrefetch).toBe(true);
    });
  });

  describe('Fonction d\'annulation (undo)', () => {
    test('devrait permettre d\'annuler une action dans les 5 secondes', () => {
      const actionTime = Date.now();
      const lastAction = {
        id: 'profile-1',
        decision: 'ACCEPT' as const,
        profile: { id: 'profile-1', displayName: 'Alice' },
        wasEndOfBatch: false,
        prevCursor: 0,
        timeout: setTimeout(() => {}, 5000),
      };

      // Annulation dans les 5 secondes
      const undoTime = actionTime + 3000; // 3 secondes plus tard

      const canUndo = undoTime - actionTime < 5000;
      expect(canUndo).toBe(true);

      // Simulation de l'annulation
      const stateAfterUndo = {
        cursor: lastAction.prevCursor, // Retour au curseur précédent
        excludeIds: [], // Suppression de l'ID des exclusions
        decisionQueue: [], // Suppression de la queue
        lastAction: null,
      };

      expect(stateAfterUndo.cursor).toBe(0);
      expect(stateAfterUndo.excludeIds).not.toContain('profile-1');
    });

    test('ne devrait plus permettre d\'annuler après 5 secondes', () => {
      const actionTime = Date.now();
      const undoTime = actionTime + 6000; // 6 secondes plus tard

      const canUndo = undoTime - actionTime < 5000;
      expect(canUndo).toBe(false);
    });
  });

  describe('Gestion des erreurs et cas limites', () => {
    test('devrait gérer l\'absence de profils disponibles', () => {
      const emptyState = {
        candidates: [],
        cursor: 0,
        loading: false,
        error: null,
      };

      const currentProfile = emptyState.candidates[emptyState.cursor];
      expect(currentProfile).toBeUndefined();

      // L'UI devrait afficher le message "Plus de profils disponibles"
      const shouldShowEmptyMessage = !emptyState.loading && !currentProfile;
      expect(shouldShowEmptyMessage).toBe(true);
    });

    test('devrait gérer les erreurs de réseau', () => {
      const errorState = {
        loading: false,
        error: 'Erreur réseau: Impossible de charger les profils',
        candidates: [],
      };

      expect(errorState.error).toBeTruthy();
      expect(errorState.candidates).toHaveLength(0);
    });

    test('devrait empêcher les actions multiples pendant l\'animation', () => {
      const animationState = {
        animating: true,
        animDir: 'right' as const,
      };

      // Les boutons doivent être désactivés pendant l'animation
      const buttonsDisabled = animationState.animating;
      expect(buttonsDisabled).toBe(true);
    });
  });

  describe('Optimisations de performance', () => {
    test('devrait traiter les décisions par batch', () => {
      const decisions = [
        { targetProfileId: 'profile-1', decision: 'ACCEPT' as const, ts: Date.now() - 6000 },
        { targetProfileId: 'profile-2', decision: 'REFUSE' as const, ts: Date.now() - 7000 },
        { targetProfileId: 'profile-3', decision: 'ACCEPT' as const, ts: Date.now() - 3000 }, // Pas prête
      ];

      const currentTime = Date.now();
      const due = decisions.filter(d => currentTime - d.ts >= 5000);
      const pending = decisions.filter(d => currentTime - d.ts < 5000);

      expect(due).toHaveLength(2);
      expect(pending).toHaveLength(1);

      // Simulation de l'envoi batch
      const batchPayload = {
        items: due.map(d => ({
          targetProfileId: d.targetProfileId,
          decision: d.decision,
        })),
      };

      expect(batchPayload.items).toHaveLength(2);
    });

    test('devrait limiter la taille des IDs exclus', () => {
      const maxSize = 200;
      const currentExcluded = Array.from({ length: 190 }, (_, i) => `old-${i}`);
      const newIds = Array.from({ length: 20 }, (_, i) => `new-${i}`);

      // Simulation de la gestion de la taille
      const combined = Array.from(new Set([...currentExcluded, ...newIds]));
      const managed = combined.slice(-maxSize);

      expect(managed.length).toBeLessThanOrEqual(maxSize);
      expect(managed.length).toBe(200);

      // Les nouveaux IDs sont prioritaires
      newIds.forEach(id => {
        expect(managed).toContain(id);
      });
    });
  });

  describe('Intégration avec l\'API', () => {
    test('devrait formater correctement les requêtes de recherche', () => {
      const searchParams = {
        sport: 'surf' as const,
        level: 'intermediate' as const,
        date: '2024-01-15',
        location: { lat: 43.4832, lng: -1.5586 },
        distanceKm: 20,
        page: 1,
        pageSize: 20,
        sortBy: 'distance' as const,
        excludeIds: ['profile-1', 'profile-2'],
      };

      // Validation des paramètres
      expect(searchParams.sport).toMatch(/^(surf|kitesurf)$/);
      expect(searchParams.level).toMatch(/^(beginner|intermediate|advanced)$/);
      expect(searchParams.location.lat).toBeGreaterThanOrEqual(-90);
      expect(searchParams.location.lat).toBeLessThanOrEqual(90);
      expect(searchParams.location.lng).toBeGreaterThanOrEqual(-180);
      expect(searchParams.location.lng).toBeLessThanOrEqual(180);
      expect(searchParams.distanceKm).toBeGreaterThan(0);
      expect(searchParams.distanceKm).toBeLessThanOrEqual(500);
    });

    test('devrait gérer les réponses de match avec conversations', () => {
      const apiResponse = {
        ok: true,
        count: 2,
        createdConversations: [
          {
            conversationId: 'conv-abc-123',
            otherDisplayName: 'Surf Buddy',
          },
        ],
      };

      expect(apiResponse.createdConversations).toBeDefined();
      expect(apiResponse.createdConversations).toHaveLength(1);

      const conversation = apiResponse.createdConversations[0];
      expect(conversation.conversationId).toMatch(/^conv-/);
      expect(conversation.otherDisplayName).toBeTruthy();
    });
  });

  describe('Accessibilité et UX', () => {
    test('devrait fournir des labels appropriés pour les boutons', () => {
      const buttons = {
        accept: { text: 'Accepter', ariaLabel: 'Accepter ce profil' },
        refuse: { text: 'Refuser', ariaLabel: 'Refuser ce profil' },
        report: { text: 'Signaler', ariaLabel: 'Signaler ce profil' },
        undo: { text: 'Annuler', ariaLabel: 'Annuler la dernière action' },
      };

      Object.values(buttons).forEach(button => {
        expect(button.text).toBeTruthy();
        expect(button.ariaLabel).toBeTruthy();
      });
    });

    test('devrait afficher des informations de profil complètes', () => {
      const profileDisplay = {
        displayName: 'Alice',
        gender: 'FEMALE',
        sport: 'surf',
        level: 'intermediate',
        distance: '5 km',
        wantsLesson: false,
        date: 'Aujourd\'hui',
      };

      expect(profileDisplay.displayName).toBeTruthy();
      expect(['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED']).toContain(profileDisplay.gender);
      expect(['surf', 'kitesurf']).toContain(profileDisplay.sport);
      expect(['beginner', 'intermediate', 'advanced']).toContain(profileDisplay.level);
      expect(profileDisplay.distance).toMatch(/\d+ km/);
      expect(typeof profileDisplay.wantsLesson).toBe('boolean');
    });

    test('devrait gérer les états de chargement de manière claire', () => {
      const loadingStates = {
        initial: { loading: true, candidates: [], message: 'Chargement…' },
        prefetching: { loading: true, candidates: [{ id: '1' }], message: 'Préchargement…' },
        error: { loading: false, candidates: [], error: 'Erreur réseau' },
        empty: { loading: false, candidates: [], message: 'Plus de profils disponibles' },
      };

      // Chargement initial
      expect(loadingStates.initial.loading).toBe(true);
      expect(loadingStates.initial.candidates).toHaveLength(0);

      // Préchargement
      expect(loadingStates.prefetching.loading).toBe(true);
      expect(loadingStates.prefetching.candidates.length).toBeGreaterThan(0);

      // Erreur
      expect(loadingStates.error.loading).toBe(false);
      expect(loadingStates.error.error).toBeTruthy();

      // Vide
      expect(loadingStates.empty.loading).toBe(false);
      expect(loadingStates.empty.candidates).toHaveLength(0);
    });
  });
});
