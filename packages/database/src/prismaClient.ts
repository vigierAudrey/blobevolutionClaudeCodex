import { PrismaClient, Prisma } from '@prisma/client';

// Production-optimized connection pooling configuration
const prismaClientConfig: Prisma.PrismaClientOptions = {
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],

  // Connection pool optimization for production performance
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },

  // Query optimization flags
  ...(process.env.NODE_ENV === 'production' && {
    // Enable query optimization for production
    engineType: 'binary' as const,
  }),
};

// Global singleton pattern to prevent multiple connections
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaClientConfig);

// Prevent multiple instances in development (hot reloading)
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Graceful shutdown handling for connection cleanup
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

