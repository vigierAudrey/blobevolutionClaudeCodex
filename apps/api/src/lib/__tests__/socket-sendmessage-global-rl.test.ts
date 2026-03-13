import { createServer, type Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { Role, clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../index';
import { createTestSession, getAccessToken } from '../../tests/helpers/auth';

const TEST_PORT = 4113;
const RUN_TAG = `ws-send-global-rl-${Date.now()}`;
const FLOOD_COUNT = 100;

type SocketAck = {
  ok: boolean;
  error?: {
    code?: string;
    message?: string;
  };
};

type InitializeSocketFn = (httpServer: HttpServer) => SocketIOServer;

async function waitForServer(httpServer: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });
}

async function connectClient(port: number, token: string): Promise<ClientSocket> {
  return new Promise<ClientSocket>((resolve, reject) => {
    const client = ioClient(`http://localhost:${port}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false
    });

    const timeout = setTimeout(() => {
      client.disconnect();
      reject(new Error('Socket connection timeout'));
    }, 4000);

    client.on('connect', () => {
      clearTimeout(timeout);
      resolve(client);
    });

    client.on('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function emitWithAck(socket: ClientSocket, event: string, payload: unknown, timeoutMs = 3000): Promise<SocketAck> {
  return new Promise<SocketAck>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Ack timeout: ${event}`)), timeoutMs);
    socket.emit(event, payload, (ackPayload: SocketAck) => {
      clearTimeout(timeout);
      resolve(ackPayload);
    });
  });
}

describe('Socket send-message global rate limit (P1)', () => {
  const app = createApp();
  const clients: ClientSocket[] = [];

  let httpServer: HttpServer;
  let socketServer: SocketIOServer;
  let initializeSocketFn: InitializeSocketFn;
  let previousRateLimitFlag: string | undefined;

  beforeAll(async () => {
    previousRateLimitFlag = process.env.ENABLE_WEBSOCKET_RATE_LIMIT;
    process.env.ENABLE_WEBSOCKET_RATE_LIMIT = 'true';

    jest.resetModules();
    const socketModule = require('../socket') as { initializeSocket: InitializeSocketFn };
    initializeSocketFn = socketModule.initializeSocket as InitializeSocketFn;

    httpServer = createServer(app);
    socketServer = initializeSocketFn(httpServer);
    await waitForServer(httpServer, TEST_PORT);
  });

  afterAll(async () => {
    for (const client of clients) {
      try {
        client.disconnect();
      } catch {
        // ignore
      }
    }

    if (socketServer) socketServer.close();
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }

    if (previousRateLimitFlag === undefined) {
      delete process.env.ENABLE_WEBSOCKET_RATE_LIMIT;
    } else {
      process.env.ENABLE_WEBSOCKET_RATE_LIMIT = previousRateLimitFlag;
    }

    await prisma.user.deleteMany({
      where: { email: { contains: RUN_TAG } }
    });
  });

  it('blocks flood globally before unbounded DB membership checks', async () => {
    const session = await createTestSession(app);
    const auth = await getAccessToken({
      app,
      session,
      email: `sender-${RUN_TAG}@test.com`,
      role: Role.RIDER,
      emailVerified: true
    });

    const senderSocket = await connectClient(TEST_PORT, auth.accessToken);
    clients.push(senderSocket);

    const membershipSpy = jest.spyOn(prisma.conversationMember, 'findUnique');
    const acks: SocketAck[] = [];

    for (let i = 0; i < FLOOD_COUNT; i += 1) {
      const ack = await emitWithAck(senderSocket, 'send-message', {
        conversationId: randomUUID(),
        content: `flood-${i}`,
        type: 'TEXT'
      });
      acks.push(ack);
    }

    const rateLimitedCount = acks.filter((ack) => !ack.ok && ack.error?.code === 'RATE_LIMITED').length;
    const forbiddenCount = acks.filter((ack) => !ack.ok && ack.error?.code === 'FORBIDDEN').length;

    expect(rateLimitedCount).toBeGreaterThan(0);
    expect(forbiddenCount).toBeGreaterThan(0);
    expect(membershipSpy.mock.calls.length).toBeLessThanOrEqual(35);

    membershipSpy.mockRestore();
  }, 30000);
});
