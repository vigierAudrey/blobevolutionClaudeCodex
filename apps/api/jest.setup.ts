import { clientPrisma as prisma } from '@blobinfini/database';
import { resetTrustedProxiesCache } from './src/lib/client-ip';
import { resetAuthCache } from './src/lib/socket-auth-cache';
import { closeRateLimitStore } from './src/middleware/enhanced-rate-limit';
import { cacheService } from './src/services/cache.service';

const SUPPRESSED_WARNINGS = [
  'PUSH_SERVICE_DISABLED',
  '[mailer]',
  'TWO_FACTOR_MEMORY_FALLBACK_USED',
  'TWO_FACTOR_EMAIL_FAILED',
];
const originalConsoleWarn = console.warn;

console.warn = (...args: Parameters<typeof console.warn>) => {
  const [firstArg] = args;
  if (typeof firstArg === 'string' && SUPPRESSED_WARNINGS.some((token) => firstArg.includes(token))) {
    return;
  }
  originalConsoleWarn(...args);
};

afterAll(() => {
  console.warn = originalConsoleWarn;
});

afterEach(() => {
  // Lazy require so that jest.mock() in test files intercepts two-factor.service dependencies
  // before the module is loaded — a top-level import would bind real references at setup time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { challengeCounter, memoryStore } = require('./src/services/two-factor.service') as typeof import('./src/services/two-factor.service');
  challengeCounter.clear();
  memoryStore?.clear();
  resetAuthCache();
  resetTrustedProxiesCache();
  if (process.env.NODE_ENV === 'test') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clearAnalyticsRateLimit } = require('./src/modules/analytics/analytics.controller') as typeof import('./src/modules/analytics/analytics.controller');
    clearAnalyticsRateLimit();
  }
});

// Global cleanup after all tests
afterAll(async () => {
  try {
    // Close Prisma connection
    await prisma.$disconnect();

    // Close cache service (Redis)
    await cacheService.close();

    // Close Redis/rate limiting store
    await closeRateLimitStore();

    // Clear any timers that might be running
    jest.clearAllTimers();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  } catch (error) {
    console.error('Error during test cleanup:', error);
  }
});

// Prevent test timeout due to hanging resources
jest.setTimeout(30000); // 30 seconds timeout for each test
