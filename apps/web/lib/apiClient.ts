import type { MessageListResponse, SendMessagePayload, ThreadListQuery, ThreadListResponse } from '@/types/messages';
import { z } from 'zod';
import { requestStrict, requestStrictWithStatus } from './requestStrict';
import type {
  AvailabilityLevel,
  AvailabilitySport,
  AvailabilityStatus,
  BookingAvailability,
  BookingRequestInboxItem,
  CreateBookingAvailabilityPayload,
  RiderBookingRequest,
} from './types/booking';

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

export interface GDPRPurgeResponse {
  success: boolean;
  timestamp: string;
  durationMs: number;
  message: string;
  result: {
    summary: string;
    technicalData: {
      sessionsDeleted: number;
      tokensDeleted: number;
      oldLogsDeleted: number;
      analyticsEventsDeleted: number;
      analyticsDailyAggDeleted: number;
    };
    userAnonymization: {
      phase1Anonymized: number;
      phase2Anonymized: number;
      phase3Purged: number;
    };
    relationalData: {
      conversationsDeleted: number;
      matchesDeleted: number;
      oldSearchesDeleted: number;
    };
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

export type PublicAnalyticsEventPayload =
  | { eventType: 'BLOBOSPHERE_VIEW'; consentHash: string; contentId: string }
  | { eventType: 'BLOBOSPHERE_OUTBOUND'; consentHash: string; contentId: string; domain: string; campaignId?: string }
  | { eventType: 'BLOBOSPHERE_SIGNUP'; consentHash: string; contentId?: string }
  | { eventType: 'PRO_DASHBOARD_OPEN'; consentHash: string };

export type RetentionBucket = {
  eligible: number;
  retained: number | null;
  rate: number | null;
  masked: boolean;
};

export interface AdminEngagementAnalytics {
  period: AdminAnalyticsPeriod;
  privacyThreshold: number;
  definitions: {
    riderActiveDay: string;
    proActiveDay: string;
    stickiness: string;
    retention: string;
  };
  totals: {
    riders: number;
    pros: number;
    users: number;
    newRiders: number;
    newPros: number;
  };
  stickiness: {
    dauAverage: {
      total: number;
      riders: number;
      pros: number;
    };
    mau: {
      total: number;
      riders: number;
      pros: number;
    };
    stickiness: {
      total: number;
      riders: number;
      pros: number;
    };
    timeline: Array<{ day: string; total: number; riders: number; pros: number }>;
  };
  retention: {
    riders: {
      cohortSize: number;
      day1: RetentionBucket;
      day7: RetentionBucket;
      day30: RetentionBucket;
    };
    pros: {
      cohortSize: number;
      day1: RetentionBucket;
      day7: RetentionBucket;
      day30: RetentionBucket;
    };
  };
}

export interface AdminMatchingAnalytics {
  period: AdminAnalyticsPeriod;
  privacyThreshold: number;
  definitions: {
    supplyDemand: string;
  };
  supplyDemand: Array<{
    sport: string;
    zoneLarge: string;
    demandRequests: number | null;
    supplyAvailabilities: number | null;
    ratio: number | null;
    sampleSize: number;
    masked: boolean;
  }>;
  acceptance: {
    totalRequests: number;
    acceptedRequests: number | null;
    acceptanceRate: number | null;
    medianResponseHours: number | null;
    responseSampleSize: number;
    masked: boolean;
  };
  acceptanceBySport: Array<{
    sport: string;
    totalRequests: number;
    acceptedRequests: number | null;
    acceptanceRate: number | null;
    medianResponseHours: number | null;
    masked: boolean;
  }>;
}

export interface AdminBehaviorAnalytics {
  period: AdminAnalyticsPeriod;
  privacyThreshold: number;
  definitions: {
    trustSafety: string;
    blobosphere: string;
  };
  trustSafety: {
    verifiedProsCount: number;
    totalPros: number;
    verifiedProsRate: number;
    reportsTotal: number | null;
    reportsPer1kUsers: number | null;
    reportsMasked: boolean;
    moderationMedianHours: number | null;
    moderationSampleSize: number;
    moderationMasked: boolean;
  };
  blobosphere: {
    totals: {
      pageviews: number;
      outboundClicks: number;
      signupConversions: number;
    };
    items: Array<{
      slug: string;
      title: string;
      publishedAt: string;
      cover: string | null;
      readingTimeMinutes: number;
      pageviews: number | null;
      outboundClicks: number | null;
      signupConversions: number | null;
      sampleSize: number;
      masked: boolean;
    }>;
  };
}

export interface AdminBlockedConversation {
  conversationId: string;
  blockedAt: string | null;
  user: {
    id: string;
    email: string;
    role: string;
  };
  conversation?: {
    id: string;
    type: string;
    createdAt: string;
    members: Array<{
      user: { id: string; email: string; role: string };
      blockedAt: string | null;
    }>;
  };
}

export interface AdminConversationBlockActionResult {
  conversationId: string;
  action: 'block' | 'unblock';
  updatedMembers: Array<{
    userId: string;
    email: string | null;
    role: string | null;
    blockedAt: string | null;
  }>;
}

export interface ConversationBlockHistoryResponse {
  items: AuditLogEntry[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

export interface AdminBroadcastResponse {
  success: boolean;
  target: 'ALL' | 'RIDERS' | 'PROS' | 'CUSTOM';
  sentCount: number;
  missingEmails?: string[];
}

export interface SystemAlert {
  id: string;
  type: string;
  message: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  link?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  createdBy?: { id: string; email: string | null } | null;
}

export interface SystemAlertListResponse {
  items: SystemAlert[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

export interface AdminSecurityEvent {
  id: string;
  action: string;
  resource: string;
  createdAt: string;
  ip?: string | null;
  user?: { id: string; email: string; role: string | null } | null;
}

export interface AdminSecuritySummary {
  since: string;
  items: Array<{ action: string; count: number }>;
}

export interface AdminAvailabilityStatusItem {
  id: string;
  startAt: string;
  endAt: string;
  sport: 'surf' | 'kitesurf';
  levels: string[];
  capacity: number;
  bookedCount: number;
  status: 'OPEN' | 'CLOSED';
  spotName: string | null;
  pro: {
    id: string;
    email: string;
    proProfile?: {
      businessName: string | null;
    } | null;
  };
}

export interface AdminAvailabilityStatusResponse {
  summary: {
    total: number;
    open: number;
    closed: number;
    bySport: Array<{ sport: string | null; status: 'OPEN' | 'CLOSED'; count: number }>;
  };
  items: AdminAvailabilityStatusItem[];
}

export interface LoginAttempt {
  id: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  success: boolean;
  reason: string | null;
  createdAt: string;
  userId: string | null;
  user?: { id: string; email: string; role: string | null } | null;
}

export interface LoginAttemptsResponse {
  attempts: LoginAttempt[];
  stats: {
    total: number;
    failed: number;
    successRate: string;
  };
}

export interface AdminMatchingTTFM {
  period: AdminAnalyticsPeriod;
  privacyThreshold: number;
  definitions: {
    ttfvRider: string;
    ttfvPro: string;
  };
  riders: {
    sampleSize: number;
    medianMinutes: number | null;
    p90Minutes: number | null;
    masked: boolean;
  };
  pros: {
    sampleSize: number;
    medianMinutes: number | null;
    p90Minutes: number | null;
    masked: boolean;
  };
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
      offers: Array<{
        id: string;
        sport: string;
        level: string;
        title: string;
        hourlyRate: string | null;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
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
  status: 'OPEN' | 'CLOSED';
  spotName: string | null;
  spotLat: number | null;
  spotLng: number | null;
  distanceKm: number | null;
  riders: Array<{ id: string; displayName: string; avatarUrl: string | null }>;
}

export interface NearbyProResult {
  proId: string;
  email: string;
  businessName: string | null;
  photoUrl: string | null;
  verified: boolean;
  lat: number;
  lng: number;
  distanceKm: number;
  sports: Array<'surf' | 'kitesurf'>;
  openAvailabilityCount: number;
}

export type ProBooking = {
  id: string;
  availability: BookingAvailability;
  rider: {
    id: string;
    riderProfile: {
      id: string;
      displayName: string | null;
      photoUrl: string | null;
      sex: 'FEMALE' | 'MALE' | 'OTHER' | 'UNSPECIFIED';
    } | null;
  };
};

export type RiderBooking = {
  id: string;
  availability: BookingAvailability & {
    pro: {
      id: string;
      proProfile: {
        businessName: string | null;
        photoUrl: string | null;
      } | null;
    };
  };
};

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
const CONSENT_HASH_KEY = 'blob_consent_hash';

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

function getConsentHash() {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(CONSENT_HASH_KEY);
  if (!value || !value.match(/^[a-f0-9]{64}$/i)) return null;
  return value;
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

      if (!response || !response.ok) {
        throw new Error('Unable to refresh session');
      }

      const payload = await response.json();
      if (payload?.accessToken && payload?.refreshToken) {
        setTokens(payload.accessToken, payload.refreshToken);
        return true;
      }

      throw new Error('Invalid refresh payload');
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[apiClient] Refresh token failed', error);
      }
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request(
  path: string,
  opts: RequestInit = {},
  withAuth = false,
  retry = false,
  options: { skipCsrf?: boolean } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const extraHeaders = new Headers(opts.headers ?? {});
  extraHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  const method = (opts.method || 'GET').toUpperCase();

  if (!CSRF_SAFE_METHODS.has(method) && !options.skipCsrf) {
    const token = await ensureCsrfToken();
    if (token) {
      headers['X-CSRF-Token'] = token;
    }
  }

  if (withAuth) {
    const t = getTokens();
    if (t?.accessToken) headers['Authorization'] = `Bearer ${t.accessToken}`;
  }

  const consentHash = getConsentHash();
  if (consentHash) {
    headers['X-Consent-Hash'] = consentHash;
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
        return request(path, opts, withAuth, true, options);
      }
      clearTokens();
      const sessionError: Error & { code?: string } = new Error('Session expirée, veuillez vous reconnecter');
      sessionError.code = 'SESSION_EXPIRED';
      throw sessionError;
    }
    if (res.status === 403 && typeof data?.error === 'string' && data.error.startsWith('CSRF_')) {
      cachedCsrfToken = null;
    }
    const message = data?.message || data?.error || `HTTP ${res.status}`;
    type ApiError = Error & { details?: unknown; status?: number; body?: unknown };
    const error: ApiError = new Error(message);
    error.status = res.status;
    error.body = data;
    // Passer les détails de validation s'ils existent
    if (data?.details) {
      error.details = data.details;
    }
    throw error;
  }
  return data;
}

const matchingSearchResultSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'UNSPECIFIED']).nullable(),
  sport: z.string(),
  level: z.string(),
  distanceKm: z.number().nullable(),
  wantsLesson: z.boolean(),
  lessonSport: z.string().nullable(),
  photoUrl: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
});

const matchingSearchDataSchema = z.object({
  criteria: z.record(z.any()).optional(),
  results: z.array(matchingSearchResultSchema),
  total: z.number().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().nullable().optional(),
  cached: z.boolean().optional(),
});

const matchingSearchEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: matchingSearchDataSchema,
});

const matchDecisionItemSchema = z.object({
  targetProfileId: z.string(),
  decision: z.enum(['ACCEPT', 'REFUSE']),
});

const matchDecisionsDataSchema = z.object({
  count: z.number(),
  createdConversations: z
    .array(
      z.object({
        conversationId: z.string(),
        otherDisplayName: z.string().optional(),
      })
    )
    .optional(),
});

async function buildStrictHeaders(withAuth = true) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-ENVELOPE': '1',
  };

  const csrf = await ensureCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const tokens = getTokens();
  if (withAuth && tokens?.accessToken) headers['Authorization'] = `Bearer ${tokens.accessToken}`;

  const consentHash = getConsentHash();
  if (consentHash) headers['X-Consent-Hash'] = consentHash;

  return headers;
}

async function postMatchDecisions(
  list: Array<{ targetProfileId: string; decision: 'ACCEPT' | 'REFUSE' }>,
) {
  const headers = await buildStrictHeaders(true);

  const body = matchDecisionItemSchema.array().parse(list);

  return requestStrict(
    '/matching/decisions',
    { method: 'POST', body: JSON.stringify({ items: body }), headers },
    matchDecisionsDataSchema,
  );
}

const openConversationPayloadSchema = z.object({
  targetUserId: z.string().uuid(),
});

const openConversationDataSchema = z
  .object({
    id: z.string().uuid(),
    created: z.boolean().optional(),
  })
  .strict();

const createBookingAvailabilityPayloadSchema = z.object({
  sport: z.enum(['surf', 'kitesurf']),
  levels: z.array(z.enum(['beginner', 'intermediate', 'advanced'])).min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  capacity: z.number().int().positive().max(20).optional(),
  spotName: z.string().min(1).max(120).optional(),
  spotLat: z.number().min(-90).max(90).optional(),
  spotLng: z.number().min(-180).max(180).optional(),
  price: z.number().nonnegative().max(9999).optional(),
});

const proAvailabilityDataSchema = z
  .object({
    id: z.string().uuid(),
    proUserId: z.string().uuid().optional(),
    sport: z.enum(['surf', 'kitesurf']),
    levels: z.array(z.enum(['beginner', 'intermediate', 'advanced'])),
    startAt: z.string(),
    endAt: z.string(),
    capacity: z.number().int().nullable().optional(),
    bookedCount: z.number().int().nonnegative().optional(),
    spotName: z.string().nullable().optional(),
    spotLat: z.number().nullable().optional(),
    spotLng: z.number().nullable().optional(),
    price: z.number().nullable().optional(),
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .strict();

const sendMessagePayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), content: z.string().min(1).max(1000) }),
  z.object({
    type: z.literal('PROPOSAL'),
    content: z.string().min(1).max(1000),
    meta: z.record(z.any()).optional(),
  }),
]);

const sendMessageDataSchema = z
  .object({
    id: z.string().uuid(),
    content: z.string(),
    type: z.enum(['TEXT', 'PROPOSAL']),
    createdAt: z.string(),
  })
  .strict();

// Booking API expects decision enum 'ACCEPT' | 'REJECT' and returns canonical action 'accept' | 'reject' (see API decideBookingRequestSchema).
const bookingDecisionPayloadSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT']),
});

const bookingDecisionDataSchema = z.object({
  success: z.boolean(),
  action: z.enum(['accept', 'reject']),
});

const reportProfileBodySchema = z.object({
  targetProfileId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000).optional(),
});

const reportProfileDataSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const apiClient = {
  login: (body: { email: string; password: string; consentAccepted?: boolean }) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }) as Promise<LoginResponse>,

  register: (body: { email: string; password: string; role: 'RIDER' | 'PRO'; ageConfirmed: true; consentAccepted: true }) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(body) }) as Promise<Record<string, unknown>>,

  requestPasswordReset: (email: string) =>
    request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

  resetPassword: (body: { token: string; password: string }) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) }),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify(body) }, true),

  me: () => request('/auth/me', { method: 'GET' }, true),

  logoutAll: () => request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }, true),

  resendVerification: (email: string) =>
    request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),

  send2FA: (email: string) =>
    request('/auth/2fa/send', { method: 'POST', body: JSON.stringify({ email }) }),

  verify2FA: (userId: string, code: string, consentAccepted?: boolean) =>
    request('/auth/verify-2fa', { method: 'POST', body: JSON.stringify({ userId, code, consentAccepted }) }) as Promise<LoginResponse>,

  verifyPro2FA: (email: string, code: string) =>
    request('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ email, code }) }) as Promise<LoginResponse>,

  getProfile: () => request('/profile/me', { method: 'GET' }, true),
  updateProfile: (body: Record<string, unknown>) => request('/profile/me', { method: 'PUT', body: JSON.stringify(body) }, true),

  getDisciplines: () => request('/profile/disciplines', { method: 'GET' }, true) as Promise<Array<{ sport: 'surf'|'kitesurf'; level: 'beginner'|'intermediate'|'advanced'|'anytime' }>>,
  setDisciplines: (items: Array<{ sport: 'surf'|'kitesurf'; level: 'beginner'|'intermediate'|'advanced'|'anytime' }>) =>
    request('/profile/disciplines', { method: 'PUT', body: JSON.stringify(items) }, true),

  searchMatching: (body: { sport: 'surf' | 'kitesurf'; level: 'beginner' | 'intermediate' | 'advanced' | 'anytime'; date: string; partner?: 'ALL' | 'WOMEN' | 'MEN'; distanceKm?: number; location?: { lat: number; lng: number }; page?: number; pageSize?: number; sortBy?: 'distance' | 'name'; excludeIds?: string[] }) =>
    request(
      '/matching/search',
      { method: 'POST', body: JSON.stringify(body), headers: { 'X-API-ENVELOPE': '1' } },
      true,
    ).then((payload) => {
      const envelope = matchingSearchEnvelopeSchema.safeParse(payload);
      if (envelope.success) return envelope.data.data;
      return matchingSearchDataSchema.parse(payload);
    }),

  /** @deprecated Utiliser apiClient.matchDecisions (batch) */
  matchDecision: (body: { targetProfileId: string; decision: 'ACCEPT' | 'REFUSE' }) =>
    postMatchDecisions([body]).then((result) => ({
      ok: true,
      count: result.count,
      createdConversations: result.createdConversations,
    })),

  matchDecisions: (list: Array<{ targetProfileId: string; decision: 'ACCEPT' | 'REFUSE' }>) =>
    postMatchDecisions(list),

  openConversation: (targetUserId: string) =>
    (async () => {
      const parsed = openConversationPayloadSchema.parse({ targetUserId });

      const headers = await buildStrictHeaders(true);

      return requestStrict('/conversations/open', { method: 'POST', headers, body: JSON.stringify(parsed) }, openConversationDataSchema);
    })(),

  reportProfile: (body: { targetProfileId: string; reason?: string }) =>
    (async () => {
      const parsed = reportProfileBodySchema.parse(body);

      const headers = await buildStrictHeaders(true);

      return requestStrict('/reports/profile', { method: 'POST', headers, body: JSON.stringify(parsed) }, reportProfileDataSchema);
    })(),

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
    (async () => {
      const parsed = sendMessagePayloadSchema.parse(body);

      const headers = await buildStrictHeaders(true);

      // Backward compat: return data only (original contract)
      return requestStrict(`/conversations/${id}/messages`, { method: 'POST', headers, body: JSON.stringify(parsed) }, sendMessageDataSchema);
    })(),
  // C4.2: New method that returns { data, status } for HTTP status semantic awareness
  sendMessageWithStatus: (id: string, body: SendMessagePayload) =>
    (async () => {
      const parsed = sendMessagePayloadSchema.parse(body);

      const headers = await buildStrictHeaders(true);

      return requestStrictWithStatus(`/conversations/${id}/messages`, { method: 'POST', headers, body: JSON.stringify(parsed) }, sendMessageDataSchema);
    })(),
  blockConversation: (id: string) => request(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify({ action: 'block' }) }, true),
  unblockConversation: (id: string) => request(`/conversations/${id}/block`, { method: 'POST', body: JSON.stringify({ action: 'unblock' }) }, true),
  unmatchConversation: (id: string) => request(`/conversations/${id}/unmatch`, { method: 'POST', body: JSON.stringify({}) }, true),
  trashConversation: (id: string) => request(`/conversations/${id}/trash`, { method: 'POST', body: JSON.stringify({ action: 'trash' }) }, true),
  untrashConversation: (id: string) => request(`/conversations/${id}/trash`, { method: 'POST', body: JSON.stringify({ action: 'untrash' }) }, true),
  emptyTrashConversations: () => request('/conversations/empty-trash', { method: 'POST', body: JSON.stringify({}) }, true) as Promise<{ ok: boolean; count: number }>,
  favoriteConversation: (id: string, value: boolean) => request(`/conversations/${id}/favorite`, { method: 'POST', body: JSON.stringify({ value }) }, true),

  searchUsers: (query: string) =>
    request(`/conversations/users/search?q=${encodeURIComponent(query)}`, { method: 'GET' }, true) as Promise<{
      items: Array<{ id: string; name: string | null; photoUrl: string | null; role: 'RIDER' | 'PRO' }>;
    }>,
  getConversationMembers: (conversationId: string) =>
    request(`/conversations/${conversationId}/members`, { method: 'GET' }, true) as Promise<{
      items: Array<{ id: string; name: string | null; photoUrl: string | null; role: string; isCurrentUser: boolean }>;
    }>,
  addConversationMember: (conversationId: string, userId: string) =>
    request(`/conversations/${conversationId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }, true) as Promise<{ ok: boolean }>,
  removeConversationMember: (conversationId: string, userId: string) =>
    request(`/conversations/${conversationId}/members/${userId}`, { method: 'DELETE' }, true) as Promise<{ ok: boolean }>,
  getPendingConversationInvitations: () =>
    request('/conversations/invitations/pending', { method: 'GET' }, true) as Promise<{
      items: Array<{
        id: string;
        conversationId: string;
        inviterName: string;
        inviterPhotoUrl: string | null;
        memberCount: number;
        createdAt: string;
      }>;
    }>,
  respondToConversationInvitation: (invitationId: string, action: 'ACCEPT' | 'REJECT') =>
    request(`/conversations/invitations/${invitationId}/respond`, { method: 'POST', body: JSON.stringify({ action }) }, true) as Promise<{
      ok: boolean;
      action: string;
      message: string;
    }>,

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
  trackAnalyticsEvent: (payload: PublicAnalyticsEventPayload) =>
    request('/analytics/events', { method: 'POST', body: JSON.stringify(payload) }, false, false, { skipCsrf: true }),

  // Admin
  getSecurityHealth: () => request('/security/health', { method: 'GET' }, true) as Promise<SecurityHealth>,
  getGDPRReport: () => request('/admin/gdpr/compliance-report', { method: 'GET' }, true) as Promise<GDPRReport>,
  runGDPRPurge: () => request('/admin/gdpr/run-purge', { method: 'POST' }, true) as Promise<GDPRPurgeResponse>,
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
  getAdminAvailabilityStatus: (params?: { status?: 'OPEN' | 'CLOSED'; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.limit) query.append('limit', params.limit.toString());
    const qs = query.toString();
    return request(`/admin/booking/availability-status${qs ? `?${qs}` : ''}`, { method: 'GET' }, true) as Promise<AdminAvailabilityStatusResponse>;
  },
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
  setAdminAllowedIPs: (adminId: string, allowedIPs: string[]) =>
    request(`/admin/admins/${adminId}/allowed-ips`, { method: 'PATCH', body: JSON.stringify({ allowedIPs }) }, true),
  getBlockedConversations: (limit: number = 5) => {
    const query = new URLSearchParams({ limit: limit.toString() });
    return request(`/admin/conversations/blocked?${query.toString()}`, { method: 'GET' }, true) as Promise<{
      blocked: AdminBlockedConversation[];
    }>;
  },
  adminSetConversationBlock: (
    conversationId: string,
    body: { action?: 'block' | 'unblock'; userId?: string }
  ) =>
    request(
      `/admin/conversations/${conversationId}/block`,
      { method: 'POST', body: JSON.stringify(body) },
      true
    ) as Promise<AdminConversationBlockActionResult>,
  adminUnblockAllConversations: () =>
    request('/admin/conversations/unblock-all', { method: 'POST' }, true) as Promise<{ success: boolean; count: number }>,
  getConversationBlockHistory: (params?: { page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    const qs = query.toString();
    return request(
      `/admin/conversations/blocked/history${qs ? `?${qs}` : ''}`,
      { method: 'GET' },
      true
    ) as Promise<ConversationBlockHistoryResponse>;
  },
  sendAdminBroadcast: (body: { message: string; target: 'ALL' | 'RIDERS' | 'PROS' | 'CUSTOM'; emails?: string[] }) =>
    request('/admin/conversations/broadcast', { method: 'POST', body: JSON.stringify(body) }, true) as Promise<AdminBroadcastResponse>,
  getSystemAlerts: (params?: { status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'; severity?: 'INFO' | 'WARNING' | 'CRITICAL'; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.severity) query.append('severity', params.severity);
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    const qs = query.toString();
    return request(`/admin/alerts${qs ? `?${qs}` : ''}`, { method: 'GET' }, true) as Promise<SystemAlertListResponse>;
  },
  acknowledgeAlert: (id: string) => request(`/admin/alerts/${id}/ack`, { method: 'POST' }, true) as Promise<SystemAlert>,
  resolveAlert: (id: string) => request(`/admin/alerts/${id}/resolve`, { method: 'POST' }, true) as Promise<SystemAlert>,
  getSecurityEvents: (limit: number = 5) => {
    const query = new URLSearchParams({ limit: limit.toString() });
    return request(`/admin/security/events?${query.toString()}`, { method: 'GET' }, true) as Promise<{
      events: AdminSecurityEvent[];
    }>;
  },
  getSecurityLogsSummary: (days: number = 7) =>
    request(`/admin/security/logs/summary?days=${days}`, { method: 'GET' }, true) as Promise<AdminSecuritySummary>,
  getLoginAttempts: (options?: { limit?: number; onlyFailed?: boolean; suspiciousOnly?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.onlyFailed) params.append('onlyFailed', 'true');
    if (options?.suspiciousOnly) params.append('suspiciousOnly', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/admin/security/login-attempts${query}`, { method: 'GET' }, true) as Promise<LoginAttemptsResponse>;
  },
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
  searchNearbyPros: (params: {
    lat: number;
    lng: number;
    radiusKm?: number;
    sport?: 'surf' | 'kitesurf';
  }) => {
    const query = new URLSearchParams();
    query.append('lat', params.lat.toString());
    query.append('lng', params.lng.toString());
    query.append('radiusKm', (params.radiusKm ?? 25).toString());
    if (params.sport) query.append('sport', params.sport);
    return request(`/booking/pros/nearby?${query.toString()}`, { method: 'GET' }, true) as Promise<{ pros: NearbyProResult[] }>;
  },
  getBookingAvailabilitiesForPro: () =>
    request('/booking/availability/me', { method: 'GET' }, true) as Promise<{ availabilities: BookingAvailability[] }> ,
  createBookingAvailability: (payload: CreateBookingAvailabilityPayload) =>
    (async () => {
      const parsed = createBookingAvailabilityPayloadSchema.parse(payload);

      const headers = await buildStrictHeaders(true);

      return requestStrict('/booking/availability', { method: 'POST', headers, body: JSON.stringify(parsed) }, proAvailabilityDataSchema);
    })(),
  updateBookingAvailability: (availabilityId: string, payload: Partial<CreateBookingAvailabilityPayload>) =>
    request(`/booking/availability/${availabilityId}`, { method: 'PATCH', body: JSON.stringify(payload) }, true) as Promise<BookingAvailability>,
  adjustBookingAvailabilityBookedCount: (availabilityId: string, delta: number) =>
    request(`/booking/availability/${availabilityId}/adjust-booked`, { method: 'PATCH', body: JSON.stringify({ delta }) }, true) as Promise<BookingAvailability>,
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
    (async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const csrf = await ensureCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const t = getTokens();
      if (t?.accessToken) headers['Authorization'] = `Bearer ${t.accessToken}`;

      const payload = bookingDecisionPayloadSchema.parse({ decision });

      return requestStrict(
        `/booking/requests/${requestId}/decision`,
        { method: 'POST', body: JSON.stringify(payload), headers },
        bookingDecisionDataSchema
      );
    })(),
  getProBookings: () =>
    request('/booking/bookings/me', { method: 'GET' }, true) as Promise<{ bookings: ProBooking[] }>,
  getRiderBookings: () =>
    request('/booking/bookings/rider/me', { method: 'GET' }, true) as Promise<{ bookings: RiderBooking[] }>,
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
  // ✅ PATCH 1 (P0 #2): Expose refresh pour WebSocket retry
  refreshToken: refreshAccessToken,
  // Blobosphère admin
  adminBlobosphereList: () => request('/admin/blobosphere/posts', { method: 'GET' }, true) as Promise<{ items: Array<{ category: string; file: string; slug: string; title: string; status: string; publishedAt: string|null }> }>,
  adminBlobosphereGet: (category: 'surf'|'kitesurf'|'communaute'|'impact', slug: string) => request(`/admin/blobosphere/posts/${category}/${slug}`, { method: 'GET' }, true) as Promise<{ raw: string }>,
  adminBlobosphereCreate: (body: { title: string; slug: string; category: 'surf'|'kitesurf'|'communaute'|'impact'; tags?: string[]; excerpt?: string; status?: 'draft'|'published'; publishedAt?: string; updatedAt?: string|null; coverImage?: string|null; readingTime?: number|null; language?: 'fr'; body?: string; }) =>
    request('/admin/blobosphere/posts', { method: 'POST', body: JSON.stringify(body) }, true) as Promise<{ success: true; path: string }>,
  adminBlobosphereUpdate: (category: 'surf'|'kitesurf'|'communaute'|'impact', slug: string, body: Partial<{ title: string; slug: string; category: 'surf'|'kitesurf'|'communaute'|'impact'; tags: string[]; excerpt: string; status: 'draft'|'published'; publishedAt: string; updatedAt: string|null; coverImage: string|null; readingTime: number|null; language: 'fr'; body: string; newSlug: string; newCategory: 'surf'|'kitesurf'|'communaute'|'impact'; }>) =>
    request(`/admin/blobosphere/posts/${category}/${slug}`, { method: 'PUT', body: JSON.stringify(body) }, true) as Promise<{ success: true; path: string }>,
};

export const __testUtils = {
  resetCsrfCache() {
    cachedCsrfToken = null;
    csrfTokenPromise = null;
  },
};
