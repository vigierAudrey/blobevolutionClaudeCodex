/**
 * Optimized API client with caching, debouncing, and parallel requests
 * Wraps the existing apiClient with performance optimizations
 */

import { apiClient } from './apiClient';
import type { UserProfileUpdate } from '@/types/user';
import { clientCache, CacheKeys, CacheTTL } from './clientCache';
import { measurePerformance } from './performanceMonitor';

// Debounce utilities
function debounce<TArgs extends unknown[], TResult>(
  func: (...args: TArgs) => Promise<TResult>,
  delay: number
): (...args: TArgs) => Promise<TResult> {
  let timeoutId: NodeJS.Timeout;
  let latestResolve: ((value: TResult) => void) | null = null;
  let latestReject: ((reason?: unknown) => void) | null = null;

  return (...args: TArgs): Promise<TResult> => {
    return new Promise((resolve, reject) => {
      // Clear existing timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Store latest promise resolvers
      latestResolve = resolve;
      latestReject = reject;

      // Set new timeout
      timeoutId = setTimeout(async () => {
        try {
          const result = await func(...args);
          latestResolve?.(result);
        } catch (error) {
          latestReject?.(error);
        }
      }, delay);
    });
  };
}

// Request deduplication
const pendingRequests = new Map<string, Promise<unknown>>();

async function deduplicateRequest<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key) as Promise<T>;
  }

  const promise = requestFn().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
}

// Cached request wrapper with performance monitoring
async function cachedRequest<T>(
  cacheKey: string,
  requestFn: () => Promise<T>,
  ttl: number = CacheTTL.PROFILE_DATA,
  endpoint?: string
): Promise<T> {
  // Check cache first
  const cached = clientCache.get<T>(cacheKey);
  if (cached) {
    // Record cache hit performance
    measurePerformance(cacheKey, true, endpoint).end();
    return cached;
  }

  // Measure request performance
  const perf = measurePerformance(cacheKey, false, endpoint);

  // Deduplicate concurrent requests
  const result = await deduplicateRequest(cacheKey, requestFn);

  // Cache the result
  clientCache.set(cacheKey, result, ttl);

  perf.end();
  return result;
}

// Optimized API client
export const optimizedApiClient = {
  // Cached user data methods
  me: () => cachedRequest(
    CacheKeys.user(),
    () => apiClient.me(),
    CacheTTL.USER_DATA,
    '/auth/me'
  ),

  getProfile: () => cachedRequest(
    CacheKeys.profile(),
    () => apiClient.getProfile(),
    CacheTTL.PROFILE_DATA,
    '/profile/me'
  ),

  getDisciplines: () => cachedRequest(
    CacheKeys.disciplines(),
    () => apiClient.getDisciplines(),
    CacheTTL.PROFILE_DATA,
    '/profile/disciplines'
  ),

  // Optimized user initialization - parallel requests
  async initializeUser() {
    try {
      const [user, profile, disciplines] = await Promise.all([
        this.me(),
        this.getProfile(),
        this.getDisciplines().catch(() => []), // Non-critical, allow to fail
      ]);

      return { user, profile, disciplines };
    } catch (error) {
      throw error;
    }
  },

  // Debounced search with caching
  searchMatching: debounce(
    async (params: Parameters<typeof apiClient.searchMatching>[0]) => {
      const cacheKey = CacheKeys.searchMatching(params);
      return cachedRequest(
        cacheKey,
        () => apiClient.searchMatching(params),
        CacheTTL.SEARCH_RESULTS
      );
    },
    300 // 300ms debounce
  ),

  // Cached conversations with shorter TTL for real-time feel
  listConversations: (
    opts?: Parameters<typeof apiClient.listConversations>[0]
  ) => cachedRequest(
    `${CacheKeys.conversations()}:${JSON.stringify(opts || {})}`,
    () => apiClient.listAllConversations(opts),
    CacheTTL.CONVERSATIONS
  ),

  // Prefetching for predicted user actions
  async prefetchMatchingData(params: Parameters<typeof apiClient.searchMatching>[0]) {
    // Prefetch next page
    const nextPageParams: Parameters<typeof apiClient.searchMatching>[0] = {
      ...params,
      page: (params.page || 1) + 1,
    };
    this.searchMatching(nextPageParams).catch(() => {}); // Silent prefetch

    // Prefetch conversations for quick access
    this.listConversations().catch(() => {});
  },

  // Cache invalidation methods
  invalidateUserData() {
    clientCache.invalidatePattern('^(user|profile):');
  },

  invalidateSearchData() {
    clientCache.invalidatePattern('^search:');
  },

  invalidateProData() {
    clientCache.invalidatePattern('^pro:');
  },

  // Pass-through methods for non-cached operations
  updateProfile: async (body: UserProfileUpdate) => {
    const result = await apiClient.updateProfile(body);
    // Invalidate related cache
    optimizedApiClient.invalidateUserData();
    return result;
  },

  setDisciplines: async (
    items: Parameters<typeof apiClient.setDisciplines>[0]
  ) => {
    const result = await apiClient.setDisciplines(items);
    // Invalidate disciplines cache
    clientCache.delete(CacheKeys.disciplines());
    return result;
  },

  matchDecisions: async (
    decisions: Parameters<typeof apiClient.matchDecisions>[0]
  ) => {
    const result = await apiClient.matchDecisions(decisions);
    // Invalidate conversations cache as new matches might be created
    clientCache.invalidatePattern('^conversations:');
    return result;
  },

  // Pass-through methods for non-optimized operations (avoid duplicates)
  login: apiClient.login,
  register: apiClient.register,
  logoutAll: apiClient.logoutAll,
  resendVerification: apiClient.resendVerification,
  reportProfile: apiClient.reportProfile,
  openConversation: apiClient.openConversation,
  getMessages: apiClient.getMessages,
  sendMessage: apiClient.sendMessage,
  blockConversation: apiClient.blockConversation,
  unblockConversation: apiClient.unblockConversation,
  unmatchConversation: apiClient.unmatchConversation,
  trashConversation: apiClient.trashConversation,
  untrashConversation: apiClient.untrashConversation,
  favoriteConversation: apiClient.favoriteConversation,
  saveTokens: apiClient.saveTokens,
  clearTokens: apiClient.clearTokens,
  getTokens: apiClient.getTokens,
  // Admin methods
  getAdminStats: apiClient.getAdminStats,
  getAdminUsers: apiClient.getAdminUsers,
  suspendUser: apiClient.suspendUser,
  verifyPro: apiClient.verifyPro,
  getAdminReports: apiClient.getAdminReports,
  moderateReport: apiClient.moderateReport,
  getAdminUser: apiClient.getAdminUser,
  getPermissions: apiClient.getPermissions,
  getAdmins: apiClient.getAdmins,
  updateAdminPermissions: apiClient.updateAdminPermissions,
  setAdminRole: apiClient.setAdminRole,
  getEngagementAnalytics: apiClient.getEngagementAnalytics,
  getMatchingAnalytics: apiClient.getMatchingAnalytics,
  getBehaviorAnalytics: apiClient.getBehaviorAnalytics,
  getMatchingTTFMAnalytics: apiClient.getMatchingTTFMAnalytics,
  getProDashboardStats:      apiClient.getProDashboardStats,
  getProContactRequests:     apiClient.getProContactRequests,
  archiveContactRequest:     apiClient.archiveContactRequest,
  unarchiveContactRequest:   apiClient.unarchiveContactRequest,
};

// Export helper for measuring performance
export const measureApiPerformance = (_name: string) => {
  const start = performance.now();
  return {
    end: () => {
      const duration = performance.now() - start;
      return duration;
    },
  };
};

// Auto-invalidate cache on profile updates
const originalUpdateProfile = apiClient.updateProfile;
apiClient.updateProfile = async (...args) => {
  const result = await originalUpdateProfile.apply(apiClient, args);
  optimizedApiClient.invalidateUserData();
  return result;
};

// Development helpers
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  // Expose cache for debugging
  type DebugCacheWindow = typeof window & {
    debugCache?: {
      cache: typeof clientCache;
      keys: typeof CacheKeys;
      ttl: typeof CacheTTL;
      stats: () => ReturnType<typeof clientCache.getStats>;
      clear: () => void;
    };
  };

  (window as DebugCacheWindow).debugCache = {
    cache: clientCache,
    keys: CacheKeys,
    ttl: CacheTTL,
    stats: () => clientCache.getStats(),
    clear: () => clientCache.clear(),
  };
}
