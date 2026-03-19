import { createServer } from 'http';

function ensureLoadSecret(key: 'SESSION_SECRET' | 'JWT_SECRET' | 'JWT_REFRESH_SECRET') {
  const current = process.env[key];
  if (current && current.length >= 64) {
    return;
  }

  process.env[key] = `${key.toLowerCase()}-active-load-blobconnect-local-only-2026-very-long-secret-material`;
}

async function main() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('start-active-user-load-api.ts must run with NODE_ENV=test');
  }

  if (String(process.env.ENABLE_RATE_LIMIT_IN_TESTS).toLowerCase() !== 'true') {
    throw new Error('ENABLE_RATE_LIMIT_IN_TESTS=true is required for active-user load API');
  }

  ensureLoadSecret('SESSION_SECRET');
  ensureLoadSecret('JWT_SECRET');
  ensureLoadSecret('JWT_REFRESH_SECRET');
  process.env.ENABLE_WEBSOCKET_RATE_LIMIT = process.env.ENABLE_WEBSOCKET_RATE_LIMIT || 'true';

  const port = Number(process.env.PORT || '4100');
  const host = process.env.HOST || '127.0.0.1';
  const { createApp } = await import('../src/index');
  const app = createApp();
  const server = createServer(app);

  server.listen(port, host, () => {
    process.stdout.write(
      JSON.stringify({
        event: 'ACTIVE_LOAD_API_READY',
        port,
        host,
        env: process.env.NODE_ENV,
        rateLimitInTests: process.env.ENABLE_RATE_LIMIT_IN_TESTS,
      }) + '\n'
    );
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
