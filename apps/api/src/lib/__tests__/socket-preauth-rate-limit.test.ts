import { createServer, type Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { createApp } from '../../index';

type InitializeSocketFn = (httpServer: HttpServer) => SocketIOServer;
type ResetPreAuthFn = () => void;
type GetHardeningMetricsFn = () => {
  preAuthRateLimit: {
    blocked: number;
    banned: number;
  };
};

const TEST_PORT = 4115;
const ALLOWED_ORIGIN = 'https://allowed.example';

async function waitForServer(httpServer: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });
}

async function attemptConnect(port: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const client = ioClient(`http://localhost:${port}`, {
      auth: { token: 'not-a-jwt' },
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Origin: ALLOWED_ORIGIN }
    });

    const timeout = setTimeout(() => {
      client.disconnect();
      resolve('timeout');
    }, 3000);

    client.on('connect', () => {
      clearTimeout(timeout);
      client.disconnect();
      resolve('connected');
    });

    client.on('connect_error', (error) => {
      clearTimeout(timeout);
      client.disconnect();
      resolve(error?.message || 'connect_error');
    });
  });
}

describe('Socket pre-auth handshake rate limit (P0)', () => {
  const app = createApp();

  let httpServer: HttpServer;
  let socketServer: SocketIOServer;
  let initializeSocketFn: InitializeSocketFn;
  let resetPreAuthRateLimit: ResetPreAuthFn;
  let getHardeningMetrics: GetHardeningMetricsFn;
  let verifySpy: jest.SpyInstance;

  const previousEnv = {
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    preAuthEnabled: process.env.WS_PREAUTH_RL_ENABLED,
    preAuthPoints: process.env.WS_PREAUTH_RL_POINTS,
    preAuthWindowMs: process.env.WS_PREAUTH_RL_WINDOW_MS,
    preAuthBaseBanMs: process.env.WS_PREAUTH_RL_BASE_BAN_MS,
    preAuthMaxBanMs: process.env.WS_PREAUTH_RL_MAX_BAN_MS
  };

  beforeAll(async () => {
    process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;
    process.env.WS_PREAUTH_RL_ENABLED = 'true';
    process.env.WS_PREAUTH_RL_POINTS = '5';
    process.env.WS_PREAUTH_RL_WINDOW_MS = '10000';
    process.env.WS_PREAUTH_RL_BASE_BAN_MS = '2000';
    process.env.WS_PREAUTH_RL_MAX_BAN_MS = '2000';

    jest.resetModules();
    verifySpy = jest.spyOn(jwt, 'verify');

    const socketModule = require('../socket') as {
      initializeSocket: InitializeSocketFn;
      getSocketHardeningMetrics: GetHardeningMetricsFn;
    };
    const preAuthModule = require('../socket-preauth-rate-limit') as {
      resetPreAuthRateLimitForTests: ResetPreAuthFn;
    };

    initializeSocketFn = socketModule.initializeSocket;
    getHardeningMetrics = socketModule.getSocketHardeningMetrics;
    resetPreAuthRateLimit = preAuthModule.resetPreAuthRateLimitForTests;

    httpServer = createServer(app);
    socketServer = initializeSocketFn(httpServer);
    await waitForServer(httpServer, TEST_PORT);
  });

  afterAll(async () => {
    verifySpy.mockRestore();

    if (socketServer) socketServer.close();
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }

    process.env.ALLOWED_ORIGINS = previousEnv.allowedOrigins;
    process.env.WS_PREAUTH_RL_ENABLED = previousEnv.preAuthEnabled;
    process.env.WS_PREAUTH_RL_POINTS = previousEnv.preAuthPoints;
    process.env.WS_PREAUTH_RL_WINDOW_MS = previousEnv.preAuthWindowMs;
    process.env.WS_PREAUTH_RL_BASE_BAN_MS = previousEnv.preAuthBaseBanMs;
    process.env.WS_PREAUTH_RL_MAX_BAN_MS = previousEnv.preAuthMaxBanMs;
  });

  beforeEach(() => {
    resetPreAuthRateLimit();
    verifySpy.mockClear();
  });

  it('blocks handshake storms before jwt.verify after threshold', async () => {
    const attempts = 20;
    const outcomes: string[] = [];

    for (let i = 0; i < attempts; i += 1) {
      outcomes.push(await attemptConnect(TEST_PORT));
    }

    const metrics = getHardeningMetrics().preAuthRateLimit;
    expect(metrics.blocked).toBeGreaterThan(0);
    expect(metrics.banned).toBeGreaterThan(0);

    // jwt.verify should be called only for early attempts before pre-auth ban.
    expect(verifySpy.mock.calls.length).toBeLessThanOrEqual(8);
  }, 20000);
});
