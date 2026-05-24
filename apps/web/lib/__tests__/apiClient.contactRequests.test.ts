jest.unmock('../apiClient');

const originalFetch = global.fetch;
const fetchMock = jest.fn<
  Promise<{ ok?: boolean; status?: number; url?: string; text?: () => Promise<string> }>,
  Parameters<typeof fetch>
>();
(global as { fetch?: unknown }).fetch = fetchMock as unknown as typeof fetch;

import {
  __testUtils,
  apiClient,
  type PendingContactRequestsResponse,
  type ContactRespondResponse,
} from '../apiClient';

const API_BASE_URL = 'http://localhost:4000';

function queueResponse(url: string, payload: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    url: `${API_BASE_URL}${url}`,
    text: async () => JSON.stringify(payload),
  });
}

// CSRF prefetch helper (POST methods need it)
function queueCsrf() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    url: `${API_BASE_URL}/csrf-token`,
    text: async () => JSON.stringify({ csrfToken: 'test-csrf-token' }),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  __testUtils.resetCsrfCache();
  if (typeof window === 'undefined') (global as { window?: unknown }).window = {};
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
    if (key === 'blob_session_hint') return '1';
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

// ─── getPendingContactRequests ────────────────────────────────────────────────

describe('getPendingContactRequests', () => {
  it('calls GET /contact/pending and returns flat DTO array', async () => {
    const payload: PendingContactRequestsResponse = {
      requests: [
        {
          id: 'req-1',
          message: 'Bonjour je souhaite vous proposer un cours',
          createdAt: '2026-05-24T10:00:00.000Z',
          conversationId: 'conv-1',
          proName: 'Surf School Pro',
        },
      ],
    };
    queueResponse('/contact/pending', payload);

    const result = await apiClient.getPendingContactRequests();

    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].id).toBe('req-1');
    expect(result.requests[0].proName).toBe('Surf School Pro');

    const calls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calls.some((u) => u.includes('/contact/pending'))).toBe(true);
  });

  it('returns empty requests array when no pending requests', async () => {
    queueResponse('/contact/pending', { requests: [] });

    const result = await apiClient.getPendingContactRequests();
    expect(result.requests).toHaveLength(0);
  });

  it('proName is "Professionnel" when server returns fallback', async () => {
    const payload: PendingContactRequestsResponse = {
      requests: [
        {
          id: 'req-2',
          message: null,
          createdAt: '2026-05-24T11:00:00.000Z',
          conversationId: 'conv-2',
          proName: 'Professionnel',
        },
      ],
    };
    queueResponse('/contact/pending', payload);

    const result = await apiClient.getPendingContactRequests();
    expect(result.requests[0].proName).toBe('Professionnel');
  });

  it('throws on 401 (unauthenticated)', async () => {
    queueResponse('/contact/pending', { error: 'Unauthorized' }, false, 401);

    await expect(apiClient.getPendingContactRequests()).rejects.toThrow();
  });

  it('throws on 500 (server error)', async () => {
    queueResponse('/contact/pending', { error: 'Internal error' }, false, 500);

    await expect(apiClient.getPendingContactRequests()).rejects.toThrow();
  });
});

// ─── respondToContactRequest ──────────────────────────────────────────────────

describe('respondToContactRequest', () => {
  it('calls POST /contact/respond with ACCEPT and returns ACCEPTED status', async () => {
    queueCsrf();
    const payload: ContactRespondResponse = {
      success: true,
      status: 'ACCEPTED',
      message: 'Le professionnel a été ajouté à votre conversation',
    };
    queueResponse('/contact/respond', payload);

    const result = await apiClient.respondToContactRequest('req-1', 'ACCEPT');

    expect(result.success).toBe(true);
    expect(result.status).toBe('ACCEPTED');
    expect(result.message).toBeTruthy();

    const postCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/contact/respond'));
    expect(postCall).toBeDefined();
    const bodyParsed = JSON.parse((postCall?.[1] as RequestInit)?.body as string);
    expect(bodyParsed.contactRequestId).toBe('req-1');
    expect(bodyParsed.response).toBe('ACCEPT');
  });

  it('calls POST /contact/respond with REJECT and returns REJECTED status', async () => {
    queueCsrf();
    const payload: ContactRespondResponse = {
      success: true,
      status: 'REJECTED',
      message: 'Demande refusée',
    };
    queueResponse('/contact/respond', payload);

    const result = await apiClient.respondToContactRequest('req-1', 'REJECT');
    expect(result.status).toBe('REJECTED');
  });

  it('returns PENDING when not all riders have responded', async () => {
    queueCsrf();
    const payload: ContactRespondResponse = {
      success: true,
      status: 'PENDING',
      message: 'Réponse enregistrée, en attente des autres participants',
    };
    queueResponse('/contact/respond', payload);

    const result = await apiClient.respondToContactRequest('req-1', 'ACCEPT');
    expect(result.status).toBe('PENDING');
  });

  it('throws on 409 ALREADY_RESPONDED', async () => {
    queueCsrf();
    queueResponse(
      '/contact/respond',
      { error: 'ALREADY_RESPONDED', message: 'You have already responded to this contact request' },
      false,
      409,
    );

    const err = await apiClient.respondToContactRequest('req-1', 'ACCEPT').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(409);
    expect((err as { body?: { error?: string } }).body?.error).toBe('ALREADY_RESPONDED');
  });

  it('throws on 409 CONTACT_REQUEST_ALREADY_RESOLVED', async () => {
    queueCsrf();
    queueResponse(
      '/contact/respond',
      { error: 'CONTACT_REQUEST_ALREADY_RESOLVED', status: 'ACCEPTED' },
      false,
      409,
    );

    const err = await apiClient.respondToContactRequest('req-1', 'ACCEPT').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { body?: { error?: string } }).body?.error).toBe('CONTACT_REQUEST_ALREADY_RESOLVED');
  });

  it('throws on 409 CONCURRENT_UPDATE', async () => {
    queueCsrf();
    queueResponse(
      '/contact/respond',
      { error: 'CONCURRENT_UPDATE', message: 'Please retry' },
      false,
      409,
    );

    const err = await apiClient.respondToContactRequest('req-1', 'ACCEPT').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { body?: { error?: string } }).body?.error).toBe('CONCURRENT_UPDATE');
  });

  it('throws on 429 (rate limit)', async () => {
    queueCsrf();
    queueResponse(
      '/contact/respond',
      { error: 'CONTACT_RESPOND_RATE_LIMIT_EXCEEDED', message: 'Too many responses. Please wait before responding again.' },
      false,
      429,
    );

    const err = await apiClient.respondToContactRequest('req-1', 'ACCEPT').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(429);
  });

  it('throws on 404 (request not found)', async () => {
    queueCsrf();
    queueResponse('/contact/respond', { error: 'Contact request not found' }, false, 404);

    const err = await apiClient.respondToContactRequest('req-1', 'ACCEPT').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(404);
  });

  it('throws on 403 (forbidden — pro trying to respond to own request)', async () => {
    queueCsrf();
    queueResponse('/contact/respond', { error: 'Forbidden' }, false, 403);

    const err = await apiClient.respondToContactRequest('req-1', 'ACCEPT').catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(403);
  });
});
