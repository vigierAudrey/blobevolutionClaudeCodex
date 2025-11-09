import type {
  BookingAvailability,
  BookingRequestInboxItem,
  CreateBookingAvailabilityPayload,
  AvailabilityLevel,
  AvailabilitySport,
  AvailabilityStatus,
  RiderBookingRequest,
} from './types/booking';
import type { ThreadListQuery, ThreadListResponse, MessageListResponse, SendMessagePayload } from '@/types/messages';

export interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  metadata: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: string;
  user?: { id: string; email: string; role: string | null };
}

export interface AuditLogResponse {
  items: AuditLogEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface AuditLogQuery {
  page?: number;
  limit?: number;
  action?: string;
  userId?: string;
  resource?: string;
  startDate?: string;
  endDate?: string;
}

export interface GDPRReport {
  timestamp: string;
  compliance: {
    isCompliant: boolean;
    issues: string[];
    recommendations: string[];
  };
  details: {
    expiredSessionsCount: number;
    expiredTokensCount: number;
    unanonymizedDeletedUsers: number;
    oldDeletedUsersAwaitingPurge: number;
  };
  legalProtection: {
    consentArchiveEnabled: boolean;
    retentionPeriod: string;
    anonymizationDelay: string;
  };
}

export interface SecurityHealth {
  status: 'SECURE' | 'VULNERABLE';
  helmet: boolean;
  csrf: boolean;
  rateLimit: boolean;
  corsWhitelist: string[];
  issues: string[];
}

export type LoginResponse = { accessToken: string; refreshToken: string };

export type AdminAnalyticsPeriod = '7d' | '30d' | '90d' | '1y';

export interface AdminEngagementAnalytics {
  overview: {
    totalUsers: number;
    totalRiders: number;
    totalPros: number;
    activeUsersLast7Days: number;
    newUsersInPeriod: number;
    retentionRates: {
      day1: number;
      day7: number;
      day30: number;
    };
  };
  registrations: Array<{
    period: string;
    total: number;
    riders: number;
    pros: number;
  }>;
  activeUsers: Array<{
    period: string;
    count: number;
  }>;
  period: AdminAnalyticsPeriod;
}

export interface AdminMatchingAnalytics {
  overview: {
    totalDecisions: number;
    acceptedCount: number;
    refusedCount: number;
    acceptRate: number;
    refuseRate: number;
    matchRate: number;
    matchedConversations: number;
    geoUsageRate: number;
  };
  decisionTimeline: Array<{
    period: string;
    accepted: number;
    refused: number;
    total: number;
  }>;
  conversationTimeline: Array<{
    period: string;
    conversations: number;
  }>;
  periodGranularity: 'day' | 'week' | 'month';
  matchesOverTime: Array<{
    period: string;
    count: number;
  }>;
  sportPreferences: Array<{
    sport: string;
    count: number;
  }>;
  levelPreferences: Array<{
    level: string;
    count: number;
  }>;
  searchesBySport: Array<{
    sport: string;
    count: number;
  }>;
  period: AdminAnalyticsPeriod;
}

export interface AdminBehaviorAnalytics {
  period: AdminAnalyticsPeriod;
  userJourney: {
    totals: {
      users: number;
      riders: number;
      pros: number;
    };
    riders: {
      profileCreated: number;
      displayName: number;
      disciplines: number;
      photo: number;
      onboardingComplete: number;
      searchConfigured: number;
      recentNewUsers: number;
      recentProfiles: number;
      recentDisciplines: number;
      recentPhotoUpdates: number;
      recentDecisions: number;
      recentMessagers: number;
    };
    pros: {
      profileCreated: number;
      offersPublished: number;
      verified: number;
      recentNewUsers: number;
      recentProfiles: number;
      recentOffers: number;
    };
  };
  sessions: {
    totalSessions: number;
    uniqueUsers: number;
    avgSessionsPerUser: number;
    avgDurationSeconds: number;
    medianDurationSeconds: number;
    maxDurationSeconds: number;
    distribution: Array<{ sessions: number; users: number }>;
  };
  featureUsage: {
    messaging: {
      totalMessages: number;
      activeConversations: number;
      uniqueSenders: number;
      avgMessagesPerConversation: number;
      avgMessagesPerSender: number;
    };
    geolocation: {
      ridersWithLocation: number;
      searchesWithGeo: number;
      activeOffers: number;
      geoSearchRate: number;
    };
    search: {
      totalSearchUpdates: number;
      geoSearches: number;
      avgDistanceKm: number | null;
      uniqueSearchers: number;
      period: AdminAnalyticsPeriod;
    };
  };
  support: {
    totalReports: number;
    reportsByReason: Array<{ reason: string; count: number }>;
  };
}

export interface AdminMatchingTTFM {
  period: AdminAnalyticsPeriod;
  sampleSize: number;
  averageDays: number;
  medianDays: number;
  p90Days: number;
  buckets: Array<{ label: string; count: number }>;
  newRidersInPeriod: number;
  ridersWithoutMatch: number;
  periodGranularity: 'day' | 'week' | 'month';
  timeline: Array<{ period: string; averageDays: number; count: number }>;
}

export type ConsentMode = 'personalized' | 'npa' | 'limited' | 'none';
export type ConsentSignal = 'granted' | 'denied';

export interface ConsentRecord {
  userHash: string;
  consentLevel: ConsentMode;
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
  cmpVersion?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentResponse {
  consent: ConsentRecord | null;
}

export type ModerationAction = 'approve' | 'dismiss' | 'ban';

export interface AdminModerationResponse {
  success: true;
  action: ModerationAction;
  reportId: string;
  bannedUserId?: string;
}

export interface AdminUserDetail {
  user: {
    id: string;
    email: string;
    role: 'RIDER' | 'PRO' | 'ADMIN';
    createdAt: string;
    deletedAt: string | null;
    emailVerified: boolean;
    consentedAt?: string | null;
    consentVersion?: string | null;
    riderProfile?: {
      id: string;
      displayName: string | null;
      bio: string | null;
      sex: string;
      maxDistanceKm: number | null;
      emailNotif: boolean;
      photoUrl: string | null;
      lat: number | null;
      lng: number | null;
      wantsLesson: boolean;
      lessonSport: string | null;
      createdAt: string;
      updatedAt: string;
      disciplines: Array<{ sport: string; level: string; createdAt: string }>;
    };
    proProfile?: {
      id: string;
      businessName: string | null;
      bio: string | null;
      pricePerHour: string | null;
      verified: boolean;
      lat: number | null;
      lng: number | null;
      createdAt: string;
      updatedAt: string;
      offers: Array<{ id: string; sport: string; level: string; title: string; hourlyRate: string; isActive: boolean; createdAt: string; updatedAt: string }>;
    };
    adminProfile?: {
      displayName: string | null;
      permissions: string[];
      lastLoginAt: string | null;
    };
    lastSearch?: {
      sport: string;
      level: string;
      distanceKm: number | null;
      lat: number | null;
      lng: number | null;
      updatedAt: string;
    } | null;
  };
  metrics: {
    reportsReceived: number;
    reportsSubmitted: number;
    sessionsCount: number;
  };
}

export interface BookingAvailabilityResult {
  id: string;
  pro: {
    userId: string;
    email: string;
    businessName: string | null;
  };
  sport: 'surf' | 'kitesurf';
  levels: string[];
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
  spotName: string | null;
  spotLat: number | null;
  spotLng: number | null;
  distanceKm: number | null;
  riders: Array<{ id: string; displayName: string; avatarUrl: string | null }>;
}

type BookingRequestInboxApiItem = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  message?: string | null;
  createdAt: string;
  respondedAt?: string | null;
  availability: {
    id: string;
    startAt: string;
    endAt: string;
    spotName: string | null;
    sport: AvailabilitySport;
    levels: AvailabilityLevel[];
    capacity: number;
    bookedCount: number;
    status: AvailabilityStatus;
  };
  rider: {
    id: string;
    email: string;
    riderProfile?: {
      displayName?: string | null;
      photoUrl?: string | null;
    } | null;
  };
};

type BookingRequestMeApiItem = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  message?: string | null;
  createdAt: string;
  respondedAt?: string | null;
  availability: {
    id: string;
    sport: AvailabilitySport;
    levels: AvailabilityLevel[];
    spotName: string | null;
    startAt: string;
    endAt: string;
    pro: {
      email: string;
      proProfile?: {
        businessName?: string | null;
      } | null;
    };
  };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
let cachedCsrfToken: string | null = null;
let csrfTokenPromise: Promise<string | null> | null = null;

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/csrf-token`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) {
      cachedCsrfToken = null;
      return cachedCsrfToken;
    }

    const payload = await res.json();
    cachedCsrfToken = typeof payload?.csrfToken === 'string' ? payload.csrfToken : null;
  } catch {
    cachedCsrfToken = null;
  } finally {
    csrfTokenPromise = null;
  }

  return cachedCsrfToken;
}

async function ensureCsrfToken(): Promise<string | null> {
  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }

  if (!csrfTokenPromise) {
    csrfTokenPromise = fetchCsrfToken();
  }

  return csrfTokenPromise;
}

function getTokens() {
  if (typeof window === 'undefined') return null;
  const accessToken = localStorage.getItem('accessToken') || '';
  const refreshToken = localStorage.getItem('refreshToken') || '';
  return { accessToken, refreshToken };
}

function setTokens(access: string, refresh: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}

function clearTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  const tokens = getTokens();
  const refreshToken = tokens?.refreshToken;
  if (!refreshToken) {
    return false;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error('Unable to refresh session');
      }

      const payload = await response.json();
      if (payload?.accessToken && payload?.refreshToken) {
        setTokens(payload.accessToken, payload.refreshToken);
        return true;
      }

      throw new Error('Invalid refresh payload');
    } catch (error) {
      console.warn('[apiClient] Refresh token failed', error);
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request(path: string, opts: RequestInit = {}, withAuth = false, retry = false) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const extraHeaders = new Headers(opts.headers ?? {});
  extraHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  const method = (opts.method || 'GET').toUpperCase();

  if (!CSRF_SAFE_METHODS.has(method)) {
    const token = await ensureCsrfToken();
    if (token) {
      headers['X-CSRF-Token'] = token;
    }
  }

  if (withAuth) {
    const t = getTokens();
    if (t?.accessToken) headers['Authorization'] = `Bearer ${t.accessToken}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    credentials: 'include',
    headers,
    cache: 'no-store', // Désactive le cache HTTP pour éviter les conflits entre profils
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && withAuth) {
      const refreshed = !retry ? await refreshAccessToken() : false;
      if (refreshed) {
        return request(path, opts, withAuth, true);
      }
      clearTokens();
      const sessionError: Error & { code?: string } = new Error('Session expirée, veuillez vous reconnecter');
      sessionError.code = 'SESSION_EXPIRED';
      throw sessionError;
    }
    if (res.status === 403 && typeof data?.error === 'string' && data.error.startsWith('CSRF_')) {
      cachedCsrfToken = null;
    }
    const message = data?.error || `HTTP ${res.status}`;
    type ApiError = Error & { details?: unknown };
    const error: ApiError = new Error(message);
    // Passer les détails de validation s'ils existent
    if (data?.details) {
      error.details = data.details;
    }
    throw error;
  }
  return data;
}

export const apiClient = {
  login: (body: { email: string; password: string; consentAccepted?: boolean }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }) as Promise<LoginResponse>,

  register: (body: { email: string; password: string; role: 'RIDER' | 'PRO'; consentAccepted: true }) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(body) }) as Promise<Record<string, unknown>>,

  me: () => request('/auth/me', { method: 'GET' }, true),

  logoutAll: () => request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }, true),

  resendVerification: (email: string) =>
    request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),

  send2FA: (email: string) =>
    request('/auth/2fa/send', { method: 'POST', body: JSON.stringify({ email }) }),

  verify2FA: (email: string, code: string) =>
    request('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ email, code }) }) as Promise<LoginResponse>,

  getProfile: () => request('/profile/me', { method: 'GET' }, true),
  updateProfile: (body: Record<string, unknown>) => request('/profile/me', { method: 'PUT', body: JSON.stringify(body) }, true),

  getDisciplines: () => request('/profile/disciplines', { method: 'GET' }, true) as Promise<Array<{ sport: 'surf'|'kitesurf'; level: 'beginner'|'intermediate'|'advanced' }>>,
  setDisciplines: (items: Array<{ sport: 'surf'|'kitesurf'; level: 'beginner'|'intermediate'|'advanced' }>) =>
    request('/profile/disciplines', { method: 'PUT', body: JSON.stringify(items) }, true),

  searchMatching: (body: { sport: 'surf' | 'kitesurf'; level: 'beginner' | 'intermediate' | 'advanced'; date: string; partner?: 'ALL' | 'WOMEN' | 'MEN'; distanceKm?: number; location?: { lat: number; lng: number }; page?: number; pageSize?: number; sortBy?: 'distance' | 'name'; excludeIds?: string[] }) =>
    request('/matching/search', { method: 'POST', body: JSON.stringify(body) }, true),

  matchDecision: (body: { targetProfileId: string; decision: 'ACCEPT' | 'REFUSE' }) =>
    request('/matching/decision', { method: 'POST', body: JSON.stringify(body) }, true),

  matchDecisions: (list: Array<{ targetProfileId: string; decision: 'ACCEPT' | 'REFUSE' }>) =>
    request('/matching/decisions', { method: 'POST', body: JSON.stringify({ items: list }) }, true),

  openConversation: (targetUserId: string) =>
    request('/conversations/open', { method: 'POST', body: JSON.stringify({ targetUserId }) }, true) as Promise<{ id: string }>,

  reportProfile: (body: { targetProfileId: string; reason?: string }) =>
    request('/reports/profile', { method: 'POST', body: JSON.stringify(body) }, true),

  listConversations: (opts?: ThreadListQuery) => {
    const params = new URLSearchParams();
    if (opts?.includeTrashed) params.append('includeTrashed', 'true');
    if (opts?.type) params.append('type', opts.type);
    const query = params.toString();
    return request(`/conversations${query ? `?${query}` : ''}`, { method: 'GET' }, true) as Promise<ThreadListResponse>;
  },
  getMessages: (id: string, cursor?: string, limit: number = 50) =>
    request(
      `/conversations/${id}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=${limit}` : `?limit=${limit}`}`,
      { method: 'GET' },
      true,
    ) as Promise<MessageListResponse>,
  sendMessage: (id: string, body: SendMessagePayload) =>
    request(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }, true),
  blockConversation: (id: string) => request(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify({ action: 'block' }) }, true),
  unblockConversation: (id: string) => request(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify({ action: 'unblock' }) }, true),
  unmatchConversation: (id: string) => request(`/conversations/${id}/unmatch`, { method: 'POST', body: JSON.stringify({}) }, true),
  trashConversation: (id: string) => request(`/conversations/${id}/trash`, { method: 'POST', body: JSON.stringify({ action: 'trash' }) }, true),
  untrashConversation: (id: string) => request(`/conversations/${id}/trash`, { method: 'POST', body: JSON.stringify({ action: 'untrash' }) }, true),
  favoriteConversation: (id: string, value: boolean) => request(`/conversations/${id}/favorite`, { method: 'POST', body: JSON.stringify({ value }) }, true),

  getConsent: (hash: string) =>
    request(`/consent/${hash}`, { method: 'GET' }) as Promise<ConsentResponse>,

  updateConsent: (
    hash: string,
    body: {
      consentLevel: ConsentMode;
      ad_storage: ConsentSignal;
      ad_user_data: ConsentSignal;
      ad_personalization: ConsentSignal;
      cmpVersion?: string | null;
    },
  ) =>
    request(`/consent/${hash}`, { method: 'POST', body: JSON.stringify(body) }) as Promise<ConsentResponse>,

  // Pro Offers
  getProOffer: () => request('/pro/offers/me', { method: 'GET' }, true),
  createOrUpdateProOffer: (body: { sport: 'surf' | 'kitesurf'; level: 'beginner' | 'intermediate' | 'advanced'; title: string; description: string; hourlyRate: number; isActive?: boolean }) =>
    request('/pro/offers', { method: 'POST', body: JSON.stringify(body) }, true),
  deleteProOffer: () => request('/pro/offers/me', { method: 'DELETE' }, true),
  toggleProOffer: () => request('/pro/offers/me/toggle', { method: 'PATCH' }, true),

  searchOffers: (params: { lat?: number; lng?: number; radiusKm?: number; sport?: string; level?: string }) => {
    const query = new URLSearchParams();
    if (params.lat) query.append('lat', params.lat.toString());
    if (params.lng) query.append('lng', params.lng.toString());
    if (params.radiusKm) query.append('radiusKm', params.radiusKm.toString());
    if (params.sport) query.append('sport', params.sport);
    if (params.level) query.append('level', params.level);

    return request(`/pro/offers/search?${query.toString()}`, { method: 'GET' }, true);
  },

  // Admin
  getSecurityHealth: () => request('/security/health', { method: 'GET' }, true) as Promise<SecurityHealth>,
  getGDPRReport: () => request('/admin/gdpr/compliance-report', { method: 'GET' }, true) as Promise<GDPRReport>,
  runGDPRPurge: () => request('/admin/gdpr/run-purge', { method: 'POST' }, true),
  searchLegalArchive: (userId: string) => request(`/admin/gdpr/legal-archive/${userId}`, { method: 'GET' }, true),
  getAuditLogs: (params?: AuditLogQuery) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.action) query.append('action', params.action);
    if (params?.userId) query.append('userId', params.userId);
    if (params?.resource) query.append('resource', params.resource);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    const qs = query.toString();
    return request(`/admin/audit${qs ? `?${qs}` : ''}`, { method: 'GET' }, true) as Promise<AuditLogResponse>;
  },
  getAdminStats: () => request('/admin/stats', { method: 'GET' }, true),
  getAdminUsers: (params?: { page?: number; limit?: number; role?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.role) query.append('role', params.role);
    return request(`/admin/users?${query.toString()}`, { method: 'GET' }, true);
  },
  suspendUser: (userId: string, suspended: boolean) =>
    request(`/admin/users/${userId}/suspend`, { method: 'PATCH', body: JSON.stringify({ suspended }) }, true),
  verifyPro: (userId: string, verified: boolean) =>
    request(`/admin/pros/${userId}/verify`, { method: 'PATCH', body: JSON.stringify({ verified }) }, true),
  getAdminReports: (params?: { page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    return request(`/admin/reports?${query.toString()}`, { method: 'GET' }, true);
  },
  moderateReport: (reportId: string, action: ModerationAction) =>
    request(`/admin/reports/${reportId}/action`, { method: 'POST', body: JSON.stringify({ action }) }, true) as Promise<AdminModerationResponse>,
  getAdminUser: (userId: string) =>
    request(`/admin/users/${userId}`, { method: 'GET' }, true) as Promise<AdminUserDetail>,
  getPermissions: () => request('/admin/permissions', { method: 'GET' }, true),
  getAdmins: () => request('/admin/admins', { method: 'GET' }, true),
  updateAdminPermissions: (adminId: string, permissions: string[]) =>
    request(`/admin/admins/${adminId}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissions }) }, true),
  setAdminRole: (adminId: string, role: string) =>
    request(`/admin/admins/${adminId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }, true),
  getEngagementAnalytics: (period?: AdminAnalyticsPeriod) => {
    const query = period ? `?period=${period}` : '';
    return request(`/admin/analytics/engagement${query}`, { method: 'GET' }, true) as Promise<AdminEngagementAnalytics>;
  },
  getMatchingAnalytics: (period?: AdminAnalyticsPeriod) => {
    const query = period ? `?period=${period}` : '';
    return request(`/admin/analytics/matching${query}`, { method: 'GET' }, true) as Promise<AdminMatchingAnalytics>;
  },
  getBehaviorAnalytics: (period?: AdminAnalyticsPeriod) => {
    const query = period ? `?period=${period}` : '';
    return request(`/admin/analytics/behavior${query}`, { method: 'GET' }, true) as Promise<AdminBehaviorAnalytics>;
  },
  getMatchingTTFMAnalytics: (period?: AdminAnalyticsPeriod) => {
    const query = period ? `?period=${period}` : '';
    return request(`/admin/analytics/matching/ttfm${query}`, { method: 'GET' }, true) as Promise<AdminMatchingTTFM>;
  },
  searchBookingAvailability: (params: {
    sport: 'surf' | 'kitesurf';
    level: 'beginner' | 'intermediate' | 'advanced';
    lat: number;
    lng: number;
    radiusKm: number;
    startAt?: string;
    endAt?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const query = new URLSearchParams();
    query.append('sport', params.sport);
    query.append('level', params.level);
    query.append('lat', params.lat.toString());
    query.append('lng', params.lng.toString());
    query.append('radiusKm', params.radiusKm.toString());
    if (params.startAt) query.append('startAt', params.startAt);
    if (params.endAt) query.append('endAt', params.endAt);
    if (params.page) query.append('page', params.page.toString());
    if (params.pageSize) query.append('pageSize', params.pageSize.toString());
    return request(`/booking/availability/search?${query.toString()}`, { method: 'GET' }, true) as Promise<{ results: BookingAvailabilityResult[] }>;
  },
  getBookingAvailabilitiesForPro: () =>
    request('/booking/availability/me', { method: 'GET' }, true) as Promise<{ availabilities: BookingAvailability[] }> ,
  createBookingAvailability: (payload: CreateBookingAvailabilityPayload) =>
    request('/booking/availability', { method: 'POST', body: JSON.stringify(payload) }, true) as Promise<BookingAvailability>,
  updateBookingAvailability: (availabilityId: string, payload: Partial<CreateBookingAvailabilityPayload>) =>
    request(`/booking/availability/${availabilityId}`, { method: 'PATCH', body: JSON.stringify(payload) }, true) as Promise<BookingAvailability>,
  deleteBookingAvailability: (availabilityId: string) =>
    request(`/booking/availability/${availabilityId}`, { method: 'DELETE' }, true) as Promise<{ success: boolean; message: string }>,
  createBookingRequest: (payload: { availabilityId: string; message?: string }) =>
    request('/booking/requests', { method: 'POST', body: JSON.stringify(payload) }, true) as Promise<{ id: string }>,
  getBookingRequestsInbox: async () => {
    const response = (await request('/booking/requests/inbox', { method: 'GET' }, true)) as {
      requests: BookingRequestInboxApiItem[];
    };
    return {
      requests: response.requests.map<BookingRequestInboxItem>((req) => ({
        id: req.id,
        status: req.status,
        riderName: req.rider.riderProfile?.displayName ?? req.rider.email,
        riderEmail: req.rider.email,
        riderAvatarUrl: req.rider.riderProfile?.photoUrl ?? null,
        message: req.message ?? null,
        createdAt: req.createdAt,
        respondedAt: req.respondedAt ?? null,
        availability: {
          id: req.availability.id,
          startAt: req.availability.startAt,
          endAt: req.availability.endAt,
          spotName: req.availability.spotName,
          sport: req.availability.sport,
          levels: req.availability.levels,
          capacity: req.availability.capacity,
          bookedCount: req.availability.bookedCount,
          status: req.availability.status,
        },
      })),
    };
  },
  decideBookingRequest: (requestId: string, decision: 'ACCEPT' | 'REJECT') =>
    request(`/booking/requests/${requestId}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }, true),
  getMyBookingRequests: async () => {
    const response = (await request('/booking/requests/me', { method: 'GET' }, true)) as {
      requests: BookingRequestMeApiItem[];
    };
    return {
      requests: response.requests.map<RiderBookingRequest>((req) => ({
        id: req.id,
        status: req.status,
        message: req.message ?? null,
        createdAt: req.createdAt,
        respondedAt: req.respondedAt ?? null,
        availability: {
          id: req.availability.id,
          sport: req.availability.sport,
          levels: req.availability.levels,
          spotName: req.availability.spotName,
          startAt: req.availability.startAt,
          endAt: req.availability.endAt,
          pro: {
            email: req.availability.pro.email,
            businessName: req.availability.pro.proProfile?.businessName ?? null,
          },
        },
      })),
    };
  },

  saveTokens: setTokens,
  clearTokens: clearTokens,
  getTokens,
};

export const __testUtils = {
  resetCsrfCache() {
    cachedCsrfToken = null;
    csrfTokenPromise = null;
  },
};
