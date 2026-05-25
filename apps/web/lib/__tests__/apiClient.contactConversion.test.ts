jest.unmock('../apiClient');

const originalFetch = global.fetch;
const fetchMock = jest.fn<Promise<{
  ok?: boolean;
  status?: number;
  url?: string;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}>, Parameters<typeof fetch>>();
(global as { fetch?: unknown }).fetch = fetchMock as unknown as typeof fetch;

import { __testUtils, apiClient, type AdminContactConversionAnalytics, type AdminConversationAnalytics } from '../apiClient';

const API_BASE_URL = 'http://localhost:4000';

const queueApiResponse = (payload: unknown, ok = true, status = 200) => {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    url: `${API_BASE_URL}/admin/analytics/contact-conversion`,
    text: async () => JSON.stringify(payload),
  });
};

beforeEach(() => {
  fetchMock.mockReset();
  __testUtils.resetCsrfCache();
  if (typeof window === 'undefined') (global as { window?: unknown }).window = {};
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
    if (key === 'accessToken') return 'fake-token';
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

// GET /admin/analytics/contact-conversion is a safe method — no CSRF prefetch.
describe('getContactConversionAnalytics', () => {
  it('calls GET /admin/analytics/contact-conversion and returns metrics', async () => {
    const payload: AdminContactConversionAnalytics = {
      requests7d: 42,
      contacted7d: 18,
      contactRatePct: 42.9,
    };

    queueApiResponse(payload);

    const result = await apiClient.getContactConversionAnalytics();

    expect(result).toEqual(payload);
    const calls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calls.some((u) => u.includes('/admin/analytics/contact-conversion'))).toBe(true);
  });

  it('returns contactRatePct null when requests7d is 0', async () => {
    const payload: AdminContactConversionAnalytics = {
      requests7d: 0,
      contacted7d: 0,
      contactRatePct: null,
    };

    queueApiResponse(payload);

    const result = await apiClient.getContactConversionAnalytics();
    expect(result.contactRatePct).toBeNull();
    expect(result.requests7d).toBe(0);
  });

  it('throws on 401', async () => {
    queueApiResponse({ error: 'Unauthorized' }, false, 401);

    await expect(apiClient.getContactConversionAnalytics()).rejects.toThrow();
  });
});

describe('getConversationAnalytics', () => {
  it('calls GET /admin/analytics/conversations and returns started metrics', async () => {
    const payload: AdminConversationAnalytics = {
      windowDays: 7,
      connectedContactsCount: 5,
      conversationsStartedCount: 3,
      conversationStartRate: 60,
      bySport: [
        { sport: 'surf', connectedContactsCount: 4, conversationsStartedCount: 2, conversationStartRate: 50 },
      ],
      timeline: [
        { day: '2026-05-25', conversationsStartedCount: 3 },
      ],
    };

    queueApiResponse(payload);

    const result = await apiClient.getConversationAnalytics(7);

    expect(result).toEqual(payload);
    const calls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calls.some((u) => u.includes('/admin/analytics/conversations?windowDays=7'))).toBe(true);
  });
});
