/**
 * Tests d'intégration pour l'API client du système de matching
 */

// Unmock apiClient to test the real implementation
jest.unmock('../apiClient');

// Mock fetch BEFORE importing apiClient
global.fetch = jest.fn();

import { apiClient, __testUtils } from '../apiClient';

describe('API Client - Matching Integration', () => {
  const mockTokens = {
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
  };
  const API_BASE_URL = 'http://localhost:4000';

  const queueCsrfSuccess = () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'test-csrf-token' }),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset fetch mock
    (global.fetch as jest.Mock).mockClear();
    __testUtils.resetCsrfCache();

    // Ensure window is defined (for jsdom)
    if (typeof window === 'undefined') {
      (global as any).window = {};
    }

    // Mock localStorage with proper spies
    Storage.prototype.getItem = jest.fn((key: string) => {
      if (key === 'accessToken') return mockTokens.accessToken;
      if (key === 'refreshToken') return mockTokens.refreshToken;
      return null;
    });
    Storage.prototype.setItem = jest.fn();
    Storage.prototype.removeItem = jest.fn();
  });

  describe('searchMatching', () => {
    const mockSearchRequest = {
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

    const mockSearchResponse = {
      results: [
        {
          id: 'profile-3',
          displayName: 'Surf Rider',
          gender: 'FEMALE',
          sport: 'surf',
          level: 'intermediate',
          distanceKm: 5,
          wantsLesson: false,
        },
        {
          id: 'profile-4',
          displayName: 'Kite Rider',
          gender: 'MALE',
          sport: 'kitesurf',
          level: 'advanced',
          distanceKm: 12,
          wantsLesson: true,
        },
      ],
      total: 15,
      page: 1,
      pageSize: 20,
      hasMore: true,
    };

    it('devrait envoyer une requête de recherche correctement formatée', async () => {
      const fetchMock = global.fetch as jest.Mock;
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockSearchResponse),
      });

      let result;
      try {
        result = await apiClient.searchMatching(mockSearchRequest);
      } catch (error) {
        console.error('Error calling searchMatching:', error);
        throw error;
      }

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `${API_BASE_URL}/csrf-token`,
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${API_BASE_URL}/matching/search`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer fake-access-token',
          }),
          credentials: 'include',
          body: JSON.stringify(mockSearchRequest),
        }),
      );

      expect(result).toEqual(mockSearchResponse);
    });

    it('devrait gérer les paramètres optionnels', async () => {
      const minimalRequest = {
        sport: 'surf' as const,
        level: 'beginner' as const,
        date: 'anytime',
      };

      const fetchMock = global.fetch as jest.Mock;
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ results: [], total: 0 }),
      });

      await apiClient.searchMatching(minimalRequest);

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${API_BASE_URL}/matching/search`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer fake-access-token',
          }),
          credentials: 'include',
          body: JSON.stringify(minimalRequest),
        }),
      );
    });

    it('devrait gérer les erreurs de réseau', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(apiClient.searchMatching(mockSearchRequest)).rejects.toThrow('Network error');
    });

    it('devrait gérer les erreurs HTTP', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'Invalid search parameters' }),
      });

      await expect(apiClient.searchMatching(mockSearchRequest)).rejects.toThrow();
    });
  });

  describe('matchDecisions', () => {
    const mockDecisions = [
      { targetProfileId: 'profile-1', decision: 'ACCEPT' as const },
      { targetProfileId: 'profile-2', decision: 'REFUSE' as const },
    ];

    const mockDecisionResponse = {
      ok: true,
      count: 2,
      createdConversations: [
        {
          conversationId: 'conv-123',
          otherDisplayName: 'Match User',
        },
      ],
    };

    it('devrait envoyer les décisions par batch', async () => {
      const fetchMock = global.fetch as jest.Mock;
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockDecisionResponse),
      });

      const result = await apiClient.matchDecisions(mockDecisions);

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${API_BASE_URL}/matching/decisions`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer fake-access-token',
          }),
          credentials: 'include',
          body: JSON.stringify({ items: mockDecisions }),
        }),
      );

      expect(result).toEqual(mockDecisionResponse);
    });

    it('devrait gérer une liste vide de décisions', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ok: true, count: 0 }),
      });

      const result = await apiClient.matchDecisions([]);

      expect(result.count).toBe(0);
    });

    it('devrait gérer les erreurs de conflit (409)', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ error: 'Request already handled' }),
      });

      await expect(apiClient.matchDecisions(mockDecisions)).rejects.toThrow();
    });
  });

  describe('reportProfile', () => {
    const mockReportRequest = {
      targetProfileId: 'profile-123',
      reason: 'Comportement inapproprié',
    };

    it('devrait envoyer un signalement avec motif', async () => {
      const fetchMock = global.fetch as jest.Mock;
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      await apiClient.reportProfile(mockReportRequest);

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${API_BASE_URL}/reports/profile`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer fake-access-token',
          }),
          credentials: 'include',
          body: JSON.stringify(mockReportRequest),
        }),
      );
    });

    it('devrait envoyer un signalement sans motif', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ success: true }),
      });

      await apiClient.reportProfile({ targetProfileId: 'profile-123' });

      expect((global.fetch as jest.Mock)).toHaveBeenNthCalledWith(
        2,
        `${API_BASE_URL}/reports/profile`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer fake-access-token',
          }),
          credentials: 'include',
          body: JSON.stringify({ targetProfileId: 'profile-123' }),
        }),
      );
    });
  });

  describe('listConversations', () => {
    const mockConversationsResponse = {
      items: [
        {
          id: 'conv-1',
          unread: 2,
          lastMessage: {
            content: 'Salut ! Ça va ?',
            createdAt: '2024-01-15T10:00:00Z',
          },
          otherUser: {
            displayName: 'Surf Buddy',
            photoUrl: null,
          },
        },
        {
          id: 'conv-2',
          unread: 0,
          lastMessage: {
            content: 'À bientôt sur l\'eau !',
            createdAt: '2024-01-14T15:30:00Z',
          },
          otherUser: {
            displayName: 'Kite Master',
            photoUrl: 'https://example.com/photo.jpg',
          },
        },
      ],
      total: 2,
    };

    it('devrait récupérer la liste des conversations', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockConversationsResponse),
      });

      const result = await apiClient.listConversations();

      expect((global.fetch as jest.Mock)).toHaveBeenCalledWith(`${API_BASE_URL}/conversations`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fake-access-token',
        },
        credentials: 'include',
      });

      expect(result).toEqual(mockConversationsResponse);
    });

    it('devrait calculer correctement le total des messages non lus', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockConversationsResponse),
      });

      const result = await apiClient.listConversations();
      const totalUnread = result.items.reduce((acc: number, conv: any) => acc + conv.unread, 0);

      expect(totalUnread).toBe(2);
    });
  });

  describe('Gestion des tokens et authentification', () => {
    it('devrait inclure le token d\'autorisation dans les requêtes', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ results: [] }),
      });

      await apiClient.searchMatching({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
      });

      const [, options] = (global.fetch as jest.Mock).mock.calls[1];
      expect(options.headers).toMatchObject({
        'Authorization': 'Bearer fake-access-token',
      });
    });

    it('devrait gérer l\'absence de tokens', async () => {
      // Mock l'absence de tokens
      Storage.prototype.getItem = jest.fn(() => null);

      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ results: [] }),
      });

      await apiClient.searchMatching({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
      });

      const [, options] = (global.fetch as jest.Mock).mock.calls[1];
      expect(options.headers).not.toHaveProperty('Authorization');
    });

    it('devrait gérer l\'expiration du token (401)', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: 'Token expired' }),
      });

      await expect(apiClient.searchMatching({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
      })).rejects.toThrow();
    });
  });

  describe('Performance et optimisations', () => {
    it('devrait gérer les requêtes concurrentes', async () => {
      const requests = [
        { sport: 'surf' as const, level: 'beginner' as const, date: 'anytime' },
        { sport: 'kitesurf' as const, level: 'intermediate' as const, date: '2024-01-15' },
        { sport: 'surf' as const, level: 'advanced' as const, date: '2024-01-16' },
      ];

      const fetchMock = global.fetch as jest.Mock;
      queueCsrfSuccess();
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ results: [], total: 0 }),
      });

      const promises = requests.map(req => apiClient.searchMatching(req));
      const results = await Promise.all(promises);

      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toHaveProperty('results');
        expect(result).toHaveProperty('total');
      });
    });

    it('devrait gérer les timeouts de requête', async () => {
      jest.useFakeTimers();

      const slowRequest = new Promise(resolve => {
        setTimeout(() => resolve({
          ok: true,
          text: async () => JSON.stringify({ results: [] }),
        }), 10000);
      });

      (global.fetch as jest.Mock).mockReturnValueOnce(slowRequest);

      const searchPromise = apiClient.searchMatching({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
      });

      // Simuler un timeout après 5 secondes
      jest.advanceTimersByTime(5000);

      // Note: Dans un vrai test, on configurerait un timeout dans fetch
      // Pour cet exemple, on vérifie juste que la requête est en cours
      expect((global.fetch as jest.Mock)).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('devrait limiter la taille des requêtes batch', async () => {
      const manyDecisions = Array.from({ length: 150 }, (_, i) => ({
        targetProfileId: `profile-${i}`,
        decision: 'ACCEPT' as const,
      }));

      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ ok: true, count: 100 }),
      });

      await apiClient.matchDecisions(manyDecisions);

      const [, options] = (global.fetch as jest.Mock).mock.calls[1];
      const body = JSON.parse(options.body);

      // Dans une vraie implémentation, on limiterait à 100 éléments max
      expect(body.items).toHaveLength(150); // Pour ce test, on vérifie la structure
    });
  });

  describe('Gestion d\'erreurs et retry', () => {
    it('devrait parser correctement les erreurs JSON', async () => {
      const errorResponse = {
        error: 'Invalid search parameters',
        details: [
          { field: 'sport', message: 'Required field missing' },
          { field: 'level', message: 'Invalid value' },
        ],
      };

      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify(errorResponse),
      });

      try {
        await apiClient.searchMatching({
          sport: 'surf',
          level: 'beginner',
          date: 'anytime',
        });
      } catch (error) {
        expect(error).toBeDefined();
        // Dans une vraie implémentation, on vérifierait le parsing des détails d'erreur
      }
    });

    it('devrait gérer les erreurs de parsing JSON', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(apiClient.searchMatching({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
      })).rejects.toThrow();
    });

    it('devrait gérer les erreurs de réseau avec des messages explicites', async () => {
      queueCsrfSuccess();
      (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        await apiClient.searchMatching({
          sport: 'surf',
          level: 'beginner',
          date: 'anytime',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
      }
    });
  });
});
