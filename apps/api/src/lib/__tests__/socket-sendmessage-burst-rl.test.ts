import { createServer, type Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { Role, clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../index';
import { createTestSession, getAccessToken } from '../../tests/helpers/auth';

type InitializeSocketFn = (httpServer: HttpServer) => SocketIOServer;
type SocketAck = {
  ok: boolean;
  error?: {
    code?: string;
  };
};

const TEST_PORT = 4116;
const RUN_TAG = `ws-send-burst-rl-${Date.now()}`;
const FLOOD_COUNT = 200;

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
    }, 5000);

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

async function emitWithAck(socket: ClientSocket, event: string, payload: unknown, timeoutMs = 5000): Promise<SocketAck> {
  return new Promise<SocketAck>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Ack timeout: ${event}`)), timeoutMs);
    socket.emit(event, payload, (ackPayload: SocketAck) => {
      clearTimeout(timeout);
      resolve(ackPayload);
    });
  });
}

describe('Socket send-message burst limiter (P1)', () => {
  const app = createApp();
  const clients: ClientSocket[] = [];

  let httpServer: HttpServer;
  let socketServer: SocketIOServer;
  let initializeSocketFn: InitializeSocketFn;
  let previousEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    previousEnv = {
      ENABLE_WEBSOCKET_RATE_LIMIT: process.env.ENABLE_WEBSOCKET_RATE_LIMIT,
      WS_BURST_POINTS_PER_SEC: process.env.WS_BURST_POINTS_PER_SEC,
      WS_BURST_CAPACITY: process.env.WS_BURST_CAPACITY,
      WS_BURST_STRICT_POINTS_PER_SEC: process.env.WS_BURST_STRICT_POINTS_PER_SEC,
      WS_BURST_STRICT_CAPACITY: process.env.WS_BURST_STRICT_CAPACITY,
      WS_BURST_BLOCK_MS: process.env.WS_BURST_BLOCK_MS
    };

    process.env.ENABLE_WEBSOCKET_RATE_LIMIT = 'true';
    process.env.WS_BURST_POINTS_PER_SEC = '5';
    process.env.WS_BURST_CAPACITY = '5';
    process.env.WS_BURST_STRICT_POINTS_PER_SEC = '3';
    process.env.WS_BURST_STRICT_CAPACITY = '3';
    process.env.WS_BURST_BLOCK_MS = '1000';

    jest.resetModules();
    const socketModule = require('../socket') as { initializeSocket: InitializeSocketFn };
    initializeSocketFn = socketModule.initializeSocket;

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

    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete (process.env as any)[key];
      else process.env[key] = value;
    });

    await prisma.user.deleteMany({
      where: { email: { contains: RUN_TAG } }
    });
  });

  it('absorbs 200 msg burst while keeping DB checks bounded and event loop healthy', async () => {
    const session = await createTestSession(app);
    const auth = await getAccessToken({
      app,
      session,
      email: `burst-${RUN_TAG}@test.com`,
      role: Role.RIDER,
      emailVerified: true
    });

    const senderSocket = await connectClient(TEST_PORT, auth.accessToken);
    clients.push(senderSocket);

    const membershipSpy = jest.spyOn(prisma.conversationMember, 'findUnique');
    const loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();

    const tasks: Array<Promise<SocketAck>> = [];
    for (let i = 0; i < FLOOD_COUNT; i += 1) {
      tasks.push(
        emitWithAck(senderSocket, 'send-message', {
          conversationId: randomUUID(),
          content: `burst-${i}`,
          type: 'TEXT'
        })
      );
    }

    const acks = await Promise.all(tasks);
    const rateLimitedCount = acks.filter((ack) => !ack.ok && ack.error?.code === 'RATE_LIMITED').length;

    // Give monitorEventLoopDelay a short window to aggregate post-burst.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const eventLoopP99Ms = loopDelay.percentile(99) / 1e6;
    loopDelay.disable();

    expect(rateLimitedCount).toBeGreaterThan(0);
    expect(membershipSpy.mock.calls.length).toBeLessThanOrEqual(20);
    expect(eventLoopP99Ms).toBeLessThan(1000);

    membershipSpy.mockRestore();
  }, 30000);

  it('rate-limits a coordinated burst from two clients in the same conversation', async () => {
    const senderASession = await createTestSession(app);
    const senderBSession = await createTestSession(app);

    const senderA = await getAccessToken({
      app,
      session: senderASession,
      email: `burst-a-${RUN_TAG}@test.com`,
      role: Role.RIDER,
      emailVerified: true
    });
    const senderB = await getAccessToken({
      app,
      session: senderBSession,
      email: `burst-b-${RUN_TAG}@test.com`,
      role: Role.RIDER,
      emailVerified: true
    });

    await prisma.riderProfile.createMany({
      data: [
        { userId: senderA.userId, displayName: 'Burst Sender A' },
        { userId: senderB.userId, displayName: 'Burst Sender B' },
      ],
      skipDuplicates: true,
    });

    const conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [{ userId: senderA.userId }, { userId: senderB.userId }],
        },
      },
      select: { id: true },
    });

    const socketA = await connectClient(TEST_PORT, senderA.accessToken);
    const socketB = await connectClient(TEST_PORT, senderB.accessToken);
    clients.push(socketA, socketB);

    await emitWithAck(socketA, 'join-conversation', { conversationId: conversation.id });
    await emitWithAck(socketB, 'join-conversation', { conversationId: conversation.id });

    const tasks: Array<Promise<SocketAck>> = [];
    for (let i = 0; i < 40; i += 1) {
      tasks.push(
        emitWithAck(socketA, 'send-message', {
          conversationId: conversation.id,
          content: `burst-a-${i}`,
          type: 'TEXT'
        }),
        emitWithAck(socketB, 'send-message', {
          conversationId: conversation.id,
          content: `burst-b-${i}`,
          type: 'TEXT'
        })
      );
    }

    const acks = await Promise.all(tasks);
    const rateLimitedCount = acks.filter((ack) => !ack.ok && ack.error?.code === 'RATE_LIMITED').length;
    const successCount = acks.filter((ack) => ack.ok).length;

    expect(successCount).toBeGreaterThan(0);
    expect(rateLimitedCount).toBeGreaterThan(0);
  }, 30000);
});
