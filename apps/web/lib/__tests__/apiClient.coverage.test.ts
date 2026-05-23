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

import { __testUtils, apiClient, type AdminCoverageAnalytics } from '../apiClient';

const API_BASE_URL = 'http://localhost:4000';

const queueApiResponse = (payload: unknown, ok = true, status = 200) => {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    url: `${API_BASE_URL}/admin/analytics/coverage`,
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

describe('getCoverageAnalytics', () => {
  it('calls GET /admin/analytics/coverage and returns metrics', async () => {
    const payload: AdminCoverageAnalytics = {
      requests7d: 120,
      covered7d: 95,
      coverageRatePct: 79.2,
    };

    queueApiResponse(payload);

    const result = await apiClient.getCoverageAnalytics();

    expect(result).toEqual(payload);
    const calls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calls.some((u) => u.includes('/admin/analytics/coverage'))).toBe(true);
  });

  it('returns coverageRatePct null when requests7d is 0', async () => {
    const payload: AdminCoverageAnalytics = {
      requests7d: 0,
      covered7d: 0,
      coverageRatePct: null,
    };

    queueApiResponse(payload);

    const result = await apiClient.getCoverageAnalytics();
    expect(result.coverageRatePct).toBeNull();
    expect(result.requests7d).toBe(0);
  });

  it('throws on API error (401)', async () => {
    queueApiResponse({ error: 'Unauthorized' }, false, 401);

    await expect(apiClient.getCoverageAnalytics()).rejects.toThrow();
  });
});
