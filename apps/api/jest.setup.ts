import { prisma } from '@blobinfini/database';
import { closeRateLimitStore } from './src/middleware/enhanced-rate-limit';
import { cacheService } from './src/services/cache.service';

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