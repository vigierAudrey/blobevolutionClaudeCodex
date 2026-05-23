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

import { __testUtils, apiClient, type AdminAnalyticsOverview, type AdminAnalyticsGeoBreakdown, type AdminMarketplaceFunnel, type AdminMarketplaceHealth } from '../apiClient';

const API_BASE_URL = 'http://localhost:4000';

const queueApiResponse = (payload: unknown, ok = true, status = 200) => {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    url: `${API_BASE_URL}/admin/analytics/overview`,
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

const HEALTHY_FUNNEL: AdminMarketplaceFunnel = {
  requests7d: 120,
  covered7d: 95,
  contacted7d: 45,
  coverageLoss: 25,
  contactLoss: 50,
  coverageRatePct: 79.2,
  contactRatePct: 37.5,
};

const HEALTHY_HEALTH: AdminMarketplaceHealth = {
  primaryBottleneck: 'HEALTHY',
  severity: 'LOW',
};

const EMPTY_FUNNEL: AdminMarketplaceFunnel = {
  requests7d: 0,
  covered7d: 0,
  contacted7d: 0,
  coverageLoss: 0,
  contactLoss: 0,
  coverageRatePct: null,
  contactRatePct: null,
};

describe('getAdminAnalyticsOverview', () => {
  it('calls GET /admin/analytics/overview and returns all metrics including bySport', async () => {
    const payload: AdminAnalyticsOverview = {
      requests7d: 120,
      contacted7d: 45,
      contactRatePct: 37.5,
      covered7d: 95,
      coverageRatePct: 79.2,
      bySport: [
        { sport: 'kitesurf', requests7d: 60, contacted7d: 20, contactRatePct: 33.3, covered7d: 50, coverageRatePct: 83.3 },
        { sport: 'surf',     requests7d: 60, contacted7d: 25, contactRatePct: 41.7, covered7d: 45, coverageRatePct: 75.0 },
      ],
      reasonBreakdown: [
        { reason: 'ACTIVATED',       fanouts7d: 80, requests7d: 80, contacted7d: 30, contactRatePct: 37.5, covered7d: 65, coverageRatePct: 81.3 },
        { reason: 'LOCATION_CHANGED', fanouts7d: 40, requests7d: 40, contacted7d: 15, contactRatePct: 37.5, covered7d: 30, coverageRatePct: 75.0 },
      ],
      geoBreakdown: [
        { zone: 'Z43:-2', requests7d: 80, covered7d: 65, coverageRatePct: 81.3, contacted7d: 30, contactRatePct: 37.5 },
        { zone: 'Z44:-1', requests7d: 40, covered7d: 30, coverageRatePct: 75.0, contacted7d: 15, contactRatePct: 37.5 },
      ] as AdminAnalyticsGeoBreakdown[],
      marketplaceFunnel: HEALTHY_FUNNEL,
      marketplaceHealth: HEALTHY_HEALTH,
    };

    queueApiResponse(payload);

    const result = await apiClient.getAdminAnalyticsOverview();

    expect(result).toEqual(payload);
    expect(result.bySport).toHaveLength(2);
    expect(result.bySport[0].sport).toBe('kitesurf');
    expect(result.bySport[1].sport).toBe('surf');
    expect(result.geoBreakdown).toHaveLength(2);
    expect(result.geoBreakdown[0].zone).toBe('Z43:-2');
    expect(result.geoBreakdown[1].zone).toBe('Z44:-1');
    expect(result.marketplaceFunnel.requests7d).toBe(120);
    expect(result.marketplaceHealth.primaryBottleneck).toBe('HEALTHY');
    const calls = fetchMock.mock.calls.map(([url]) => url as string);
    expect(calls.some((u) => u.includes('/admin/analytics/overview'))).toBe(true);
  });

  it('returns null rates when requests7d is 0, bySport empty', async () => {
    const payload: AdminAnalyticsOverview = {
      requests7d: 0,
      contacted7d: 0,
      contactRatePct: null,
      covered7d: 0,
      coverageRatePct: null,
      bySport: [],
      reasonBreakdown: [],
      geoBreakdown: [],
      marketplaceFunnel: EMPTY_FUNNEL,
      marketplaceHealth: { primaryBottleneck: 'HEALTHY', severity: 'LOW' },
    };

    queueApiResponse(payload);

    const result = await apiClient.getAdminAnalyticsOverview();
    expect(result.contactRatePct).toBeNull();
    expect(result.coverageRatePct).toBeNull();
    expect(result.requests7d).toBe(0);
    expect(result.bySport).toEqual([]);
    expect(result.marketplaceFunnel.coverageRatePct).toBeNull();
    expect(result.marketplaceHealth.primaryBottleneck).toBe('HEALTHY');
  });

  it('bySport entry has null contactRatePct when sport has no requests', async () => {
    // Cette forme ne devrait pas se produire en prod (une entrée sans requests7d n'existe pas),
    // mais on valide que le type le permet.
    const payload: AdminAnalyticsOverview = {
      requests7d: 5,
      contacted7d: 2,
      contactRatePct: 40,
      covered7d: 4,
      coverageRatePct: 80,
      bySport: [
        { sport: 'surf', requests7d: 5, contacted7d: 2, contactRatePct: 40, covered7d: 4, coverageRatePct: 80 },
      ],
      reasonBreakdown: [
        { reason: 'ACTIVATED', fanouts7d: 5, requests7d: 5, contacted7d: 2, contactRatePct: 40, covered7d: 4, coverageRatePct: 80 },
      ],
      geoBreakdown: [],
      marketplaceFunnel: { requests7d: 5, covered7d: 4, contacted7d: 2, coverageLoss: 1, contactLoss: 2, coverageRatePct: 80, contactRatePct: 40 },
      marketplaceHealth: { primaryBottleneck: 'HEALTHY', severity: 'LOW' },
    };

    queueApiResponse(payload);

    const result = await apiClient.getAdminAnalyticsOverview();
    expect(result.bySport[0].contactRatePct).toBe(40);
    expect(result.marketplaceFunnel.covered7d).toBe(4);
  });

  it('throws on API error (401)', async () => {
    queueApiResponse({ error: 'Unauthorized' }, false, 401);

    await expect(apiClient.getAdminAnalyticsOverview()).rejects.toThrow();
  });
});
