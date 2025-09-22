/**
 * Optimized API client with caching, debouncing, and parallel requests
 * Wraps the existing apiClient with performance optimizations
 */

import { apiClient } from './apiClient';
import { clientCache, CacheKeys, CacheTTL } from './clientCache';
import { measurePerformance } from './performanceMonitor';

// Debounce utilities
type DebouncedFunction<T extends (...args: any[]) => any> = (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>;

function debounce<T extends (...args: any[]) => Promise<any>>(
  func: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: NodeJS.Timeout;
  let latestResolve: ((value: Awaited<ReturnType<T>>) => void) | null = null;
  let latestReject: ((reason?: any) => void) | null = null;

  return (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
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
const pendingRequests = new Map<string, Promise<any>>();

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
    console.log(`🚀 Cache hit: ${cacheKey}`);
    return cached;
  }

  // Measure request performance
  const perf = measurePerformance(cacheKey, false, endpoint);

  // Deduplicate concurrent requests
  const result = await deduplicateRequest(cacheKey, requestFn);

  // Cache the result
  clientCache.set(cacheKey, result, ttl);
  console.log(`💾 Cached: ${cacheKey}`);

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
    console.log('🚀 Initializing user data in parallel...');
    const start = performance.now();

    try {
      const [user, profile, disciplines] = await Promise.all([
        this.me(),
        this.getProfile(),
        this.getDisciplines().catch(() => []), // Non-critical, allow to fail
      ]);

      const duration = performance.now() - start;
      console.log(`✅ User initialized in ${duration.toFixed(1)}ms`);

      return { user, profile, disciplines };
    } catch (error) {
      console.error('❌ User initialization failed:', error);
      throw error;
    }
  },

  // Debounced search with caching
  searchMatching: debounce(
    async (params: any) => {
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
  listConversations: (opts?: any) => cachedRequest(
    `${CacheKeys.conversations()}:${JSON.stringify(opts || {})}`,
    () => apiClient.listConversations(opts),
    CacheTTL.CONVERSATIONS
  ),

  // Pro-specific optimizations
  async initializePro() {
    console.log('🚀 Initializing pro data in parallel...');
    const start = performance.now();

    try {
      const [availabilities, inbox] = await Promise.all([
        cachedRequest(
          CacheKeys.proAvailabilities(),
          () => apiClient.getBookingAvailabilitiesForPro(),
          CacheTTL.PROFILE_DATA
        ),
        cachedRequest(
          CacheKeys.proInbox(),
          () => apiClient.getBookingRequestsInbox(),
          CacheTTL.REAL_TIME
        ),
      ]);

      const duration = performance.now() - start;
      console.log(`✅ Pro data initialized in ${duration.toFixed(1)}ms`);

      return { availabilities, inbox };
    } catch (error) {
      console.error('❌ Pro initialization failed:', error);
      throw error;
    }
  },

  // Prefetching for predicted user actions
  async prefetchMatchingData(params: any) {
    console.log('🔮 Prefetching matching data...');

    // Prefetch next page
    const nextPageParams = { ...params, page: (params.page || 1) + 1 };
    this.searchMatching(nextPageParams).catch(() => {}); // Silent prefetch

    // Prefetch conversations for quick access
    this.listConversations().catch(() => {});
  },

  // Cache invalidation methods
  invalidateUserData() {
    clientCache.invalidatePattern('^(user|profile):');
    console.log('🗑️ Invalidated user data cache');
  },

  invalidateSearchData() {
    clientCache.invalidatePattern('^search:');
    console.log('🗑️ Invalidated search data cache');
  },

  invalidateProData() {
    clientCache.invalidatePattern('^pro:');
    console.log('🗑️ Invalidated pro data cache');
  },

  // Pass-through methods for non-cached operations
  updateProfile: async (body: any) => {
    const result = await apiClient.updateProfile(body);
    // Invalidate related cache
    optimizedApiClient.invalidateUserData();
    return result;
  },

  setDisciplines: async (items: any) => {
    const result = await apiClient.setDisciplines(items);
    // Invalidate disciplines cache
    clientCache.delete(CacheKeys.disciplines());
    return result;
  },

  matchDecisions: async (decisions: any) => {
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
  getProOffer: apiClient.getProOffer,
  createOrUpdateProOffer: apiClient.createOrUpdateProOffer,
  deleteProOffer: apiClient.deleteProOffer,
  toggleProOffer: apiClient.toggleProOffer,
  searchOffers: apiClient.searchOffers,
  getWallet: apiClient.getWallet,
  getTransactions: apiClient.getTransactions,
  claimWelcomeBonus: apiClient.claimWelcomeBonus,
  canSpend: apiClient.canSpend,
  searchBookingAvailability: apiClient.searchBookingAvailability,
  getBookingAvailabilitiesForPro: apiClient.getBookingAvailabilitiesForPro,
  createBookingAvailability: apiClient.createBookingAvailability,
  createBookingRequest: apiClient.createBookingRequest,
  getBookingRequestsInbox: apiClient.getBookingRequestsInbox,
  decideBookingRequest: apiClient.decideBookingRequest,
  getMyBookingRequests: apiClient.getMyBookingRequests,
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
};

// Export helper for measuring performance
export const measureApiPerformance = (name: string) => {
  const start = performance.now();
  return {
    end: () => {
      const duration = performance.now() - start;
      console.log(`⏱️ ${name}: ${duration.toFixed(1)}ms`);
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
if (process.env.NODE_ENV === 'development') {
  // Expose cache for debugging
  (window as any).debugCache = {
    cache: clientCache,
    keys: CacheKeys,
    ttl: CacheTTL,
    stats: () => clientCache.getStats(),
    clear: () => clientCache.clear(),
  };
}