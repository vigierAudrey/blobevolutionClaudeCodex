import type { MessageListResponse, SendMessagePayload, ThreadListQuery, ThreadListResponse } from '@/types/messages';
import { z } from 'zod';
import { requestStrict, requestStrictWithStatus } from './requestStrict';

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
  error?: string;
  blockedReason?: string;
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

export interface RetentionExportArtifactSummary {
  id: string;
  scope: 'AUDIT_LOG';
  format: 'NDJSON';
  status: 'GENERATING' | 'READY' | 'VERIFIED' | 'FAILED' | 'EXPIRED';
  rowCount: number;
  sha256: string | null;
  createdAt: string;
  verifiedAt: string | null;
  fromDate: string;
  toDate: string;
  createdByAdmin?: { id: string; email: string; role: string } | null;
}

export interface RetentionExportListResponse {
  exports: RetentionExportArtifactSummary[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface RetentionExportGenerateResponse {
  artifact: RetentionExportArtifactSummary;
  download: {
    fileName: string;
    mimeType: string;
    encoding: 'base64';
    content: string;
  };
}

export interface SecurityHealth {
  status: 'SECURE' | 'DEGRADED' | 'UNSAFE';
  timestamp: string;
  checks: {
    config: 'ok' | 'fail';
    env: 'ok' | 'fail';
    db: 'ok' | 'fail';
    redis: 'ok' | 'fail';
  };
}

export interface SecurityObservability {
  status: 'healthy' | 'degraded' | 'failing';
  timestamp: string;
  pipeline: {
    queued: number;
    sent: number;
    dropped: number;
    failed: number;
    breakerState: 'closed' | 'open' | 'half-open';
  };
}

/**
 * LoginResponse: tokens are now set as httpOnly cookies by the server.
 * The body only carries the 2FA intermediate state or { ok: true }.
 * Kept as union so callsites can distinguish both cases.
 */
export type TwoFactorChallengeResponse = { requires2FA: true; userId: string; message: string };
export type LoginResponse = { ok: true } | TwoFactorChallengeResponse;

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

export interface AdminLessonRequestsAnalytics {
  period: AdminAnalyticsPeriod;
  privacyThreshold: number;
  definitions: { lessonRequests: string };
  snapshot: {
    totalActive: number;
    newInPeriod: number;
    // Demandes wantsLesson=true sans mise à jour depuis > 30 jours.
    // Un taux élevé (>30 % de totalActive) indique des données fantômes.
    inactiveRequests30d: number;
    bySport: { surf: number; kitesurf: number; other: number };
    byStudentCount: { solo: number; duo: number; group: number };
  };
  byZone: Array<{
    zone: string;
    count: number | null;
    sampleSize: number;
    masked: boolean;
  }>;
  proContactStats: {
    totalContacts: number;
    distinctRidersContacted: number | null;
    contactRatePct: number | null;
    medianFirstContactHours: number | null;
    sampleSize: number;
    masked: boolean;
  };
}

export interface AdminSportBreakdown {
  // COUNT(DISTINCT lessonRequestId) sur 7 jours pour ce sport.
  requests7d: number;
  // Taux de fanouts avec ≥ 1 pro trouvé (%), null si aucun fanout.
  matchRate: number | null;
  // Moyenne pros éligibles trouvés par fanout.
  avgProsFound: number;
}

export interface AdminLessonPerformance {
  requestsToday: number;
  // requests7d = rider-jours actifs (COUNT DISTINCT lessonRequestId).
  // Un rider actif 3 jours = 3. Voir uniqueRiders7d pour les riders distincts.
  requests7d: number;
  // uniqueRiders7d = COUNT(DISTINCT riderRef) — riders réellement distincts sur 7 jours.
  uniqueRiders7d: number;
  prosNotifiedToday: number;
  prosNotified7d: number;
  avgProsPerRequest: number;
  avgProsFound: number;
  noMatchRequests: number;
  matchRate: number | null;
  notificationFailures: number;
  notificationSuccessRate: number | null;
  bySport: {
    surf: AdminSportBreakdown;
    kitesurf: AdminSportBreakdown;
    other: AdminSportBreakdown;
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

export interface ReportHistoryItem {
  id: string;
  reason?: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByAdminId: string | null;
  reviewedAction: string | null;
  reporter: {
    email: string;
    role: string;
  };
  reportedProfile: {
    id: string;
    displayName: string | null;
    user: {
      id: string;
      email: string;
      role: string;
    };
  };
  reviewedByAdmin?: {
    id: string;
    email: string;
    role: string;
  } | null;
}

export interface ReportHistoryResponse {
  items: ReportHistoryItem[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

export interface ConversationBlockHistoryItem {
  id: string;
  conversationId: string;
  userId: string;
  actorUserId?: string | null;
  actorType: 'USER' | 'ADMIN' | 'SYSTEM';
  action: 'BLOCK' | 'UNBLOCK';
  source: 'USER_SELF' | 'ADMIN_SINGLE' | 'ADMIN_BULK' | 'LEGACY_UNKNOWN';
  batchId?: string | null;
  reason?: string | null;
  createdAt: string;
  user?: { id: string; email: string; role: string | null };
  actorUser?: { id: string; email: string; role: string | null } | null;
  conversation?: { id: string; type: string; createdAt: string };
}

export interface ConversationBlockHistoryResponse {
  items: ConversationBlockHistoryItem[];
  historyReliability: {
    hasLegacyRows: boolean;
    reliableSinceDate: string;
    reliableSinceVersion: string;
  };
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
  occurrenceCount?: number;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
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

export interface LoginAttempt {
  id: string;
  email: string | null;
  emailHash: string;
  ip: string | null;
  ipHash?: string | null;
  userAgent: string | null;
  success: boolean;
  reason: string | null;
  createdAt: string;
  userId: string | null;
  user?: { id: string; role: string | null } | null;
}

export interface LoginAttemptsResponse {
  attempts: LoginAttempt[];
  /** Opaque base64url cursor for the next page. Null when no further pages. */
  nextCursor: string | null;
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
      /** F03: precise coordinates removed (RGPD minimisation) — use hasLocation for display */
      hasLocation: boolean;
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
      /** F03: precise coordinates removed (RGPD minimisation) — use hasLocation for display */
      hasLocation: boolean;
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
      // F03: lat/lng supprimés — inutiles pour l'admin, minimisation RGPD
      updatedAt: string;
    } | null;
  };
  metrics: {
    reportsReceived: number;
    reportsSubmitted: number;
    sessionsCount: number;
  };
}


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

/**
 * Session hint key — a non-sensitive flag in localStorage.
 *
 * With cookie-based auth, the actual tokens are httpOnly and cannot be read by JS.
 * This flag indicates "a session was established" for UX-only affordances.
 * It must never be treated as proof that the server-side session is still valid.
 *
 * It is NOT the token itself and carries no security value on its own.
 * The server enforces auth via the httpOnly cookie on every request.
 */
const SESSION_HINT_KEY = 'blob_session_hint';

function getTokens() {
  if (typeof window === 'undefined') return null;
  // Cookie-only auth: the actual tokens are httpOnly cookies, inaccessible to JS.
  // Return a truthy presence marker when the session hint is set for optional UX.
  // Do not use it to decide whether the user is really authenticated.
  // The hint ('1') is set by setTokens() after login and cleared on logout.
  // It carries no security value — the server enforces auth via cookie on every request.
  const hint = localStorage.getItem(SESSION_HINT_KEY);
  return hint ? { accessToken: hint, refreshToken: null as string | null } : null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setTokens(_access = '', _refresh = '') {
  // Tokens are set as httpOnly cookies by the server — nothing to store in JS.
  // We only update the local session hint to reflect likely active UX state.
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_HINT_KEY, '1');
}

function clearTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_HINT_KEY);
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

  // With cookie-based auth, the refresh token is in an httpOnly cookie scoped to
  // /auth/refresh. We don't need to read it from localStorage.
  // We DO need the CSRF token because POST /auth/refresh is a mutating endpoint.

  refreshPromise = (async () => {
    try {
      const csrfToken = await ensureCsrfToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers,
        credentials: 'include', // Browser sends refreshToken cookie (path=/auth/refresh)
      });

      if (!response || !response.ok) {
        clearTokens();
        return false;
      }

      // Validate that the server confirms the refresh succeeded.
      // A mock or unexpected response without body.ok = true is treated as failure.
      let bodyOk = false;
      try {
        const body = await response.json();
        bodyOk = body?.ok === true;
      } catch {
        // json() unavailable or parse error — treat as failed refresh
        bodyOk = false;
      }
      if (!bodyOk) {
        clearTokens();
        return false;
      }

      // Server set new accessToken cookie — re-confirm session hint is active
      setTokens();
      return true;
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

  // Auth is enforced via httpOnly cookie sent automatically with credentials:'include'.
  // The session hint in getTokens() is not a JWT — do not inject as Authorization header.

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

async function buildStrictHeaders(_withAuth = true) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-ENVELOPE': '1',
  };

  const csrf = await ensureCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  // Auth is enforced via httpOnly cookie (credentials: 'include').
  // Session hint is not a JWT — do not inject as Authorization header.

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
type OpenConversationData = z.infer<typeof openConversationDataSchema>;


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

  register: (body: {
    email: string;
    password: string;
    role: 'RIDER' | 'PRO';
    ageConfirmed: true;
    consentAccepted: true;
    countryCode?: string;
  }) =>
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

  verify2FA: (challengeId: string, code: string, consentAccepted?: boolean) =>
    request('/auth/verify-2fa', { method: 'POST', body: JSON.stringify({ challengeId, code, consentAccepted }) }) as Promise<{ ok: true }>,

  verifyPro2FA: (email: string, code: string) =>
    request('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ email, code }) }) as Promise<{ ok: true; message: string }>,

  getProfile: () => request('/profile/me', { method: 'GET' }, true),
  getProProfile: () => request('/pro/me/preview', { method: 'GET' }, true),
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

  openConversation: (targetUserId: string): Promise<OpenConversationData> =>
    (async (): Promise<OpenConversationData> => {
      const parsed = openConversationPayloadSchema.parse({ targetUserId });

      const headers = await buildStrictHeaders(true);

      return requestStrict<OpenConversationData>(
        '/conversations/open',
        { method: 'POST', headers, body: JSON.stringify(parsed) },
        openConversationDataSchema,
      );
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
    if (typeof opts?.limit === 'number') params.append('limit', String(opts.limit));
    if (opts?.cursor) params.append('cursor', opts.cursor);
    const query = params.toString();
    return request(`/conversations${query ? `?${query}` : ''}`, { method: 'GET' }, true) as Promise<ThreadListResponse>;
  },
  listAllConversations: async (
    opts?: Omit<ThreadListQuery, 'cursor'> & { maxPages?: number }
  ): Promise<ThreadListResponse> => {
    const limit = typeof opts?.limit === 'number' ? Math.min(opts.limit, 100) : 100;
    const maxPages = Math.max(1, opts?.maxPages ?? 10);
    const items: ThreadListResponse['items'] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    let hasMore = false;
    let nextCursor: string | null | undefined = null;

    do {
      const page = await apiClient.listConversations({
        ...opts,
        limit,
        cursor,
      });

      items.push(...(page.items ?? []));
      hasMore = Boolean(page.hasMore);
      nextCursor = page.nextCursor ?? null;
      cursor = page.nextCursor ?? undefined;
      pageCount += 1;
    } while (cursor && pageCount < maxPages);

    return {
      items,
      hasMore: Boolean(cursor && pageCount >= maxPages) || hasMore,
      nextCursor: cursor ?? nextCursor ?? null,
    };
  },
  findConversationById: async (
    conversationId: string,
    opts?: Omit<ThreadListQuery, 'cursor'> & { maxPages?: number }
  ) => {
    const limit = typeof opts?.limit === 'number' ? Math.min(opts.limit, 100) : 100;
    const maxPages = Math.max(1, opts?.maxPages ?? 10);
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      const page = await apiClient.listConversations({
        ...opts,
        limit,
        cursor,
      });
      const match = (page.items ?? []).find((item) => item.id === conversationId);
      if (match) {
        return match;
      }

      cursor = page.nextCursor ?? undefined;
      pageCount += 1;
    } while (cursor && pageCount < maxPages);

    return null;
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
  getSecurityObservability: () =>
    request('/security/observability', { method: 'GET' }, true) as Promise<SecurityObservability>,
  getGDPRReport: () => request('/admin/gdpr/compliance-report', { method: 'GET' }, true) as Promise<GDPRReport>,
  runGDPRPurge: () => request('/admin/gdpr/run-purge', { method: 'POST', body: JSON.stringify({ confirm: 'CONFIRMER_PURGE_RGPD' }) }, true) as Promise<GDPRPurgeResponse>,
  createRetentionExport: (body: { scope: 'AUDIT_LOG'; fromDate: string; toDate: string; format?: 'NDJSON' }) =>
    request('/admin/gdpr/exports', { method: 'POST', body: JSON.stringify(body) }, true) as Promise<RetentionExportGenerateResponse>,
  getRetentionExports: (params?: { page?: number; limit?: number; scope?: 'AUDIT_LOG'; status?: 'GENERATING' | 'READY' | 'VERIFIED' | 'FAILED' | 'EXPIRED' }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.scope) query.append('scope', params.scope);
    if (params?.status) query.append('status', params.status);
    const qs = query.toString();
    return request(`/admin/gdpr/exports${qs ? `?${qs}` : ''}`, { method: 'GET' }, true) as Promise<RetentionExportListResponse>;
  },
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
  getAdminReports: (params?: { page?: number; limit?: number; status?: 'pending' | 'reviewed' | 'all' }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.status) query.append('status', params.status);
    return request(`/admin/reports?${query.toString()}`, { method: 'GET' }, true);
  },
  getAdminReportHistory: (params?: { page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', params.page.toString());
    if (params?.limit) query.append('limit', params.limit.toString());
    const qs = query.toString();
    return request(`/admin/reports/history${qs ? `?${qs}` : ''}`, { method: 'GET' }, true) as Promise<ReportHistoryResponse>;
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
    body: { action?: 'block' | 'unblock'; userId?: string; reason?: string }
  ) =>
    request(
      `/admin/conversations/${conversationId}/block`,
      { method: 'POST', body: JSON.stringify(body) },
      true
    ) as Promise<AdminConversationBlockActionResult>,
  adminUnblockAllConversations: () =>
    request('/admin/conversations/unblock-all', { method: 'POST' }, true) as Promise<{ success: boolean; batchId: string; processedCount: number; remainingCount: number }>,
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
  getLoginAttempts: (options?: {
    /** Max 100. Values above 100 are rejected server-side. */
    limit?: number;
    onlyFailed?: boolean;
    suspiciousOnly?: boolean;
    /** Opaque cursor from a previous response's nextCursor field. */
    cursor?: string;
  }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', Math.min(options.limit, 100).toString());
    if (options?.onlyFailed) params.append('onlyFailed', 'true');
    if (options?.suspiciousOnly) params.append('suspiciousOnly', 'true');
    if (options?.cursor) params.append('cursor', options.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request(`/admin/security/login-attempts${query}`, { method: 'GET' }, true) as Promise<LoginAttemptsResponse>;
  },
  purgeLoginAttempts: (options: { dryRun?: boolean; confirm?: string } = {}) =>
    request('/admin/security/login-attempts/purge', {
      method: 'POST',
      body: JSON.stringify({ dryRun: options.dryRun ?? true, confirm: options.confirm }),
    }, true) as Promise<{
      deleted: number;
      wouldDelete: number;
      dryRun: boolean;
      batches: number;
      successRetentionDays: number;
      failureRetentionDays: number;
    }>,
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
  getLessonRequestsAnalytics: (period?: AdminAnalyticsPeriod) => {
    const query = period ? `?period=${period}` : '';
    return request(`/admin/analytics/lesson-requests${query}`, { method: 'GET' }, true) as Promise<AdminLessonRequestsAnalytics>;
  },
  getLessonPerformanceAnalytics: () =>
    request('/admin/analytics/lesson-performance', { method: 'GET' }, true) as Promise<AdminLessonPerformance>,
  /**
   * saveTokens — Activates the local session hint flag.
   * Tokens themselves are managed as httpOnly cookies by the server.
   */
  saveTokens: setTokens,
  clearTokens: clearTokens,
  getTokens,
  // Expose refresh pour WebSocket retry
  refreshToken: refreshAccessToken,
};

export const __testUtils = {
  resetCsrfCache() {
    cachedCsrfToken = null;
    csrfTokenPromise = null;
  },
};
