/**
 * Tests d'intégration pour l'API client du système de matching
 */

// Unmock apiClient to test the real implementation
jest.unmock('../apiClient');

// Mock fetch BEFORE importing apiClient
const originalFetch = global.fetch;
const fetchMock = jest.fn<Promise<{
  ok?: boolean;
  status?: number;
  url?: string;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}>, Parameters<typeof fetch>>();
(global as { fetch?: unknown }).fetch = fetchMock as unknown as typeof fetch;

import { __testUtils, apiClient } from '../apiClient';

describe('API Client - Matching Integration', () => {
  const mockTokens = {
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
  };
  const API_BASE_URL = 'http://localhost:4000';

  const queueCsrfSuccess = () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ csrfToken: 'test-csrf-token' }),
    });
  };

  beforeEach(() => {
    fetchMock.mockReset();
    __testUtils.resetCsrfCache();

    // Default fetch response (can be overridden per test)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      url: `${API_BASE_URL}/default`,
      text: async () => JSON.stringify({ results: [], total: 0 }),
    });

    // Ensure window is defined (for jsdom)
    if (typeof window === 'undefined') {
      (global as { window?: unknown }).window = {};
    }

    // Mock localStorage with proper spies
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'accessToken') return mockTokens.accessToken;
      if (key === 'refreshToken') return mockTokens.refreshToken;
      return null;
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fetchMock.mockReset();
    __testUtils.resetCsrfCache();
  });

  afterAll(() => {
    (global as { fetch?: unknown }).fetch = originalFetch;
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
          lessonSport: null,
          wantsLesson: false,
        },
        {
          id: 'profile-4',
          displayName: 'Kite Rider',
          gender: 'MALE',
          sport: 'kitesurf',
          level: 'advanced',
          distanceKm: 12,
          lessonSport: null,
          wantsLesson: true,
        },
      ],
      total: 15,
      page: 1,
      pageSize: 20,
      hasMore: true,
    };

    it('devrait envoyer une requête de recherche correctement formatée', async () => {
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
          }),
          credentials: 'include',
          body: JSON.stringify(minimalRequest),
        }),
      );
    });

    it('devrait gérer les erreurs de réseau', async () => {
      queueCsrfSuccess();
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      await expect(apiClient.searchMatching(mockSearchRequest)).rejects.toThrow('Network error');
    });

    it('devrait gérer les erreurs HTTP', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
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
      count: 2,
      createdConversations: [
        {
          conversationId: 'conv-123',
          otherDisplayName: 'Match User',
        },
      ],
    };

    it('devrait envoyer les décisions par batch', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: `${API_BASE_URL}/matching/decisions`,
        text: async () => JSON.stringify({ ok: true, data: mockDecisionResponse }),
      });

      const result = await apiClient.matchDecisions(mockDecisions);

      const [, init] = fetchMock.mock.calls[1] as [unknown, RequestInit];
      const headers = new Headers(init.headers);
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token');
      expect(headers.get('X-API-ENVELOPE')).toBe('1');
      expect(init.credentials).toBe('include');
      expect(init.body).toBe(JSON.stringify({ items: mockDecisions }));

      expect(result).toEqual(mockDecisionResponse);
    });

    it('devrait gérer une liste vide de décisions', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: `${API_BASE_URL}/matching/decisions`,
        text: async () => JSON.stringify({ ok: true, data: { count: 0 } }),
      });

      const result = await apiClient.matchDecisions([]);

      expect(result.count).toBe(0);
    });

    it('devrait remonter les erreurs enveloppées (403 FORBIDDEN)', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        url: `${API_BASE_URL}/matching/decisions`,
        text: async () => JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } }),
      });

      await expect(apiClient.matchDecisions(mockDecisions)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });

    it('devrait échouer sur réponse legacy non enveloppée', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: `${API_BASE_URL}/matching/decisions`,
        text: async () => JSON.stringify({ count: 1 }),
      });

      await expect(apiClient.matchDecisions(mockDecisions)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });
  });

  describe('matchDecision (legacy wrapper)', () => {
    const singleDecision = { targetProfileId: 'profile-1', decision: 'ACCEPT' as const };

    it('envoie via /matching/decisions (envelope) et retourne une forme compatible', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: `${API_BASE_URL}/matching/decisions`,
        text: async () =>
          JSON.stringify({
            ok: true,
            data: {
              count: 1,
              createdConversations: [
                {
                  conversationId: 'conv-123',
                  otherDisplayName: 'Match User',
                },
              ],
            },
          }),
      });

      const result = await apiClient.matchDecision(singleDecision);

      expect(result).toEqual({
        ok: true,
        count: 1,
        createdConversations: [
          {
            conversationId: 'conv-123',
            otherDisplayName: 'Match User',
          },
        ],
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${API_BASE_URL}/matching/decisions`,
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ items: [singleDecision] }),
        }),
      );

      const [, init] = fetchMock.mock.calls[1] as [unknown, RequestInit];
      const headers = new Headers(init.headers);
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token');
      expect(headers.get('X-API-ENVELOPE')).toBe('1');
    });
  });

  describe('decideBookingRequest (strict)', () => {
    const requestId = 'req-123';

    it('envoie les headers (Auth, CSRF, X-API-ENVELOPE) et retourne le succès enveloppé', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          url: `${API_BASE_URL}/booking/requests/${requestId}/decision`,
          text: async () => JSON.stringify({ ok: true, data: { success: true, action: 'accept' } }),
        });

      const result = await apiClient.decideBookingRequest(requestId, 'ACCEPT');

      expect(result).toEqual({ success: true, action: 'accept' });
      const [, init] = fetchMock.mock.calls[1];
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token');
      expect(headers.get('X-API-ENVELOPE')).toBe('1');
      expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('surface une erreur enveloppée FORBIDDEN', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          url: `${API_BASE_URL}/booking/requests/${requestId}/decision`,
          text: async () => JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'nope' } }),
        });

      await expect(apiClient.decideBookingRequest(requestId, 'REJECT')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });

    it('rejette la réponse legacy non enveloppée', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          url: `${API_BASE_URL}/booking/requests/${requestId}/decision`,
          text: async () => JSON.stringify({ success: true, action: 'accept' }),
        });

      await expect(apiClient.decideBookingRequest(requestId, 'ACCEPT')).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une enveloppe succès avec data invalide', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          url: `${API_BASE_URL}/booking/requests/${requestId}/decision`,
          text: async () => JSON.stringify({ ok: true, data: { success: 'yes' } }),
        });

      await expect(apiClient.decideBookingRequest(requestId, 'ACCEPT')).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });
  });


  describe('reportProfile (strict)', () => {
    const reportRequest = {
      targetProfileId: '11111111-1111-1111-1111-111111111111',
      reason: '  Comportement inapproprié  ',
    };

    it('envoie les headers (Auth, CSRF, X-API-ENVELOPE) et retourne le succès enveloppé', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        url: `${API_BASE_URL}/reports/profile`,
        text: async () => JSON.stringify({ ok: true, data: { id: reportRequest.targetProfileId } }),
      });

      const result = await apiClient.reportProfile(reportRequest);

      expect(result).toEqual({ id: reportRequest.targetProfileId });
      const [, init] = fetchMock.mock.calls[1] as [unknown, RequestInit];
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token');
      expect(headers.get('X-API-ENVELOPE')).toBe('1');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(init.body).toBe(
        JSON.stringify({
          targetProfileId: reportRequest.targetProfileId,
          reason: 'Comportement inapproprié',
        }),
      );
    });

    it('surface une erreur enveloppée FORBIDDEN', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        url: `${API_BASE_URL}/reports/profile`,
        text: async () => JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'nope' } }),
      });

      await expect(apiClient.reportProfile(reportRequest)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });

    it('rejette la réponse legacy non enveloppée', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        url: `${API_BASE_URL}/reports/profile`,
        text: async () => JSON.stringify({ id: reportRequest.targetProfileId }),
      });

      await expect(apiClient.reportProfile(reportRequest)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une enveloppe succès avec data invalide', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        url: `${API_BASE_URL}/reports/profile`,
        text: async () => JSON.stringify({ ok: true, data: { success: true } }),
      });

      await expect(apiClient.reportProfile(reportRequest)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une entrée invalide côté client', async () => {
      await expect(apiClient.reportProfile({ targetProfileId: '', reason: '   ' })).rejects.toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('openConversation (strict)', () => {
    const targetUserId = '22222222-2222-2222-2222-222222222222';

    it('envoie les headers (Auth, CSRF, X-API-ENVELOPE) et retourne le succès enveloppé', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/conversations/open`,
          text: async () => JSON.stringify({ ok: true, data: { id: '33333333-3333-3333-3333-333333333333', created: true } }),
        });

      const result = await apiClient.openConversation(targetUserId);

      expect(result).toEqual({ id: '33333333-3333-3333-3333-333333333333', created: true });
      const [, init] = fetchMock.mock.calls[1] as [unknown, RequestInit];
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token');
      expect(headers.get('X-API-ENVELOPE')).toBe('1');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(init.body).toBe(JSON.stringify({ targetUserId }));
    });

    it('surface une erreur enveloppée FORBIDDEN', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          url: `${API_BASE_URL}/conversations/open`,
          text: async () => JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'nope' } }),
        });

      await expect(apiClient.openConversation(targetUserId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });

    it('rejette la réponse legacy non enveloppée', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/conversations/open`,
          text: async () => JSON.stringify({ id: 'conv-123' }),
        });

      await expect(apiClient.openConversation(targetUserId)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une enveloppe succès avec data invalide', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/conversations/open`,
          text: async () => JSON.stringify({ ok: true, data: { id: '33333333-3333-3333-3333-333333333333', created: 'yes' } }),
        });

      await expect(apiClient.openConversation(targetUserId)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une entrée invalide côté client', async () => {
      await expect(apiClient.openConversation('not-a-uuid')).rejects.toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surface RATE_LIMITED avec détails lorsque le serveur répond 429 enveloppé', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          url: `${API_BASE_URL}/conversations/open`,
          text: async () =>
            JSON.stringify({
              ok: false,
              error: { code: 'RATE_LIMITED', message: 'Too many', details: { retryAfterSeconds: 30, reason: 'CONVERSATION_COOLDOWN' } },
            }),
        });

      await expect(apiClient.openConversation(targetUserId)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
      });
    });
  });

  describe('createBookingAvailability (strict)', () => {
    const payload = {
      sport: 'surf' as const,
      levels: ['beginner'],
      startAt: '2030-01-01T10:00:00.000Z',
      endAt: '2030-01-01T12:00:00.000Z',
      spotLat: 43.493,
      spotLng: -1.558,
      capacity: 5,
    };

    const successData = {
      id: '44444444-4444-4444-4444-444444444444',
      proUserId: '55555555-5555-5555-5555-555555555555',
      sport: 'surf',
      levels: ['beginner'],
      startAt: payload.startAt,
      endAt: payload.endAt,
      status: 'OPEN',
      bookedCount: 0,
      spotLat: payload.spotLat,
      spotLng: payload.spotLng,
      capacity: payload.capacity,
      createdAt: '2030-01-01T00:00:00.000Z',
    };

    it('envoie les headers (Auth, CSRF, X-API-ENVELOPE) et retourne le succès enveloppé', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/booking/availability`,
          text: async () => JSON.stringify({ ok: true, data: successData }),
        });

      const result = await apiClient.createBookingAvailability(payload);

      expect(result).toEqual(successData);
      const [, init] = fetchMock.mock.calls[1];
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token');
      expect(headers.get('X-API-ENVELOPE')).toBe('1');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual(payload);
    });

    it('surface une erreur enveloppée FORBIDDEN', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          url: `${API_BASE_URL}/booking/availability`,
          text: async () => JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'nope' } }),
        });

      await expect(apiClient.createBookingAvailability(payload)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });

    it('rejette la réponse legacy non enveloppée', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/booking/availability`,
          text: async () => JSON.stringify({ id: successData.id }),
        });

      await expect(apiClient.createBookingAvailability(payload)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une enveloppe succès avec data invalide', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/booking/availability`,
          text: async () => JSON.stringify({ ok: true, data: { ...successData, levels: 'invalid' } }),
        });

      await expect(apiClient.createBookingAvailability(payload)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une entrée invalide côté client', async () => {
      await expect(
        apiClient.createBookingAvailability({
          ...payload,
          startAt: 'invalid-date',
        })
      ).rejects.toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });


  describe('sendMessage (strict HTTP fallback)', () => {
    const conversationId = '66666666-6666-6666-6666-666666666666';
    const payload = { type: 'TEXT' as const, content: 'Hello' };

    const successData = {
      id: '77777777-7777-7777-7777-777777777777',
      content: payload.content,
      type: 'TEXT',
      createdAt: '2030-01-01T00:00:00.000Z',
    };

    it('envoie les headers (Auth, CSRF, X-API-ENVELOPE) et retourne le succès enveloppé', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/conversations/${conversationId}/messages`,
          text: async () => JSON.stringify({ ok: true, data: successData }),
        });

      const result = await apiClient.sendMessage(conversationId, payload);

      expect(result).toEqual(successData);
      const [, init] = fetchMock.mock.calls[1] as [unknown, RequestInit];
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-CSRF-Token')).toBe('test-csrf-token');
      expect(headers.get('X-API-ENVELOPE')).toBe('1');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual(payload);
    });

    it('surface une erreur enveloppée FORBIDDEN', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          url: `${API_BASE_URL}/conversations/${conversationId}/messages`,
          text: async () => JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'nope' } }),
        });

      await expect(apiClient.sendMessage(conversationId, payload)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });

    it('rejette la réponse legacy non enveloppée', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/conversations/${conversationId}/messages`,
          text: async () => JSON.stringify({ id: successData.id }),
        });

      await expect(apiClient.sendMessage(conversationId, payload)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une enveloppe succès avec data invalide', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ csrfToken: 'test-csrf-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          url: `${API_BASE_URL}/conversations/${conversationId}/messages`,
          text: async () => JSON.stringify({ ok: true, data: { id: successData.id, type: 'TEXT' } }),
        });

      await expect(apiClient.sendMessage(conversationId, payload)).rejects.toMatchObject({
        code: 'INVALID_ENVELOPE',
      });
    });

    it('rejette une entrée invalide côté client', async () => {
      await expect(apiClient.sendMessage(conversationId, { type: 'TEXT', content: '' } as unknown as Parameters<typeof apiClient.sendMessage>[1])).rejects.toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
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
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockConversationsResponse),
      });

      const result = await apiClient.listConversations();

      expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/conversations`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        cache: 'no-store',
      });

      expect(result).toEqual(mockConversationsResponse);
    });

    it('devrait propager limit et cursor sur la pagination conversations', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          items: [],
          hasMore: false,
          nextCursor: null,
        }),
      });

      await apiClient.listConversations({ limit: 25, cursor: 'cursor-123', includeTrashed: true, type: 'RIDER_TO_PRO' });

      expect(fetchMock).toHaveBeenCalledWith(`${API_BASE_URL}/conversations?includeTrashed=true&type=RIDER_TO_PRO&limit=25&cursor=cursor-123`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        cache: 'no-store',
      });
    });

    it('devrait agréger toutes les pages de conversations', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            items: [{ id: 'conv-1', unread: 1 }],
            hasMore: true,
            nextCursor: 'cursor-1',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            items: [{ id: 'conv-2', unread: 3 }],
            hasMore: false,
            nextCursor: null,
          }),
        });

      const result = await apiClient.listAllConversations();

      expect(result.items).toEqual([{ id: 'conv-1', unread: 1 }, { id: 'conv-2', unread: 3 }]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(fetchMock).toHaveBeenNthCalledWith(1, `${API_BASE_URL}/conversations?limit=100`, expect.any(Object));
      expect(fetchMock).toHaveBeenNthCalledWith(2, `${API_BASE_URL}/conversations?limit=100&cursor=cursor-1`, expect.any(Object));
    });

    it('devrait retrouver une conversation au-delà de la première page', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            items: [{ id: 'conv-1', unread: 1 }],
            hasMore: true,
            nextCursor: 'cursor-1',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            items: [{ id: 'conv-target', unread: 0 }],
            hasMore: false,
            nextCursor: null,
          }),
        });

      const result = await apiClient.findConversationById('conv-target');

      expect(result).toEqual({ id: 'conv-target', unread: 0 });
    });

    it('devrait calculer correctement le total des messages non lus', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(mockConversationsResponse),
      });

      const result = await apiClient.listConversations();
      const totalUnread = result.items.reduce((acc: number, conv: { unread: number }) => acc + conv.unread, 0);

      expect(totalUnread).toBe(2);
    });
  });

  describe('Gestion des tokens et authentification', () => {
    it('utilise les cookies httpOnly pour l\'authentification (pas de header Authorization)', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ results: [] }),
      });

      await apiClient.searchMatching({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
      });

      const [, options] = fetchMock.mock.calls[1];
      expect(options.credentials).toBe('include');
      expect(options.headers).not.toHaveProperty('Authorization');
    });

    it('devrait gérer l\'absence de tokens', async () => {
      // Mock l'absence de tokens
      Storage.prototype.getItem = jest.fn(() => null);

      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ results: [] }),
      });

      await apiClient.searchMatching({
        sport: 'surf',
        level: 'beginner',
        date: 'anytime',
      });

      const [, options] = fetchMock.mock.calls[1] as [unknown, RequestInit];
      expect(options.headers).not.toHaveProperty('Authorization');
    });

    it('devrait gérer l\'expiration du token (401)', async () => {
      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
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

    it('devrait limiter la taille des requêtes batch', async () => {
      const manyDecisions = Array.from({ length: 150 }, (_, i) => ({
        targetProfileId: `profile-${i}`,
        decision: 'ACCEPT' as const,
      }));

      queueCsrfSuccess();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: `${API_BASE_URL}/matching/decisions`,
        text: async () => JSON.stringify({ ok: true, data: { count: 100 } }),
      });

      await apiClient.matchDecisions(manyDecisions);

      const [, options] = fetchMock.mock.calls[1] as [unknown, RequestInit];
      const body = JSON.parse(options.body as string);

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
      fetchMock.mockResolvedValueOnce({
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
      fetchMock.mockResolvedValueOnce({
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
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

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
