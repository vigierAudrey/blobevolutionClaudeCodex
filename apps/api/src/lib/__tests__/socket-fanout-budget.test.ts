import { createServer, type Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { Role, clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../index';
import { createTestSession, getAccessToken } from '../../tests/helpers/auth';

type InitializeSocketFn = (httpServer: HttpServer) => SocketIOServer;
type GetMetricsFn = () => {
  fanout: {
    pushAttempted: number;
    pushQueued: number;
    pushDroppedByBudget: number;
    pushPerMessageMax: number;
  };
};
type ResetFanoutFn = () => void;

const TEST_PORT = 4117;
const RUN_TAG = `ws-fanout-budget-${Date.now()}`;

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

async function emitWithAck<T>(socket: ClientSocket, event: string, payload: unknown, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Ack timeout: ${event}`)), timeoutMs);
    socket.emit(event, payload, (ackPayload: T) => {
      clearTimeout(timeout);
      resolve(ackPayload);
    });
  });
}

describe('Socket send-message fanout budget (P1)', () => {
  const app = createApp();
  const clients: ClientSocket[] = [];

  let httpServer: HttpServer;
  let socketServer: SocketIOServer;
  let initializeSocketFn: InitializeSocketFn;
  let getMetricsFn: GetMetricsFn;
  let resetFanoutFn: ResetFanoutFn;
  let notifyNewMessageSpy: jest.SpyInstance;

  const previousEnv = {
    pushPerMessageMax: process.env.WS_PUSH_PER_MESSAGE_MAX,
    pushQueueMaxPending: process.env.WS_PUSH_QUEUE_MAX_PENDING,
    pushQueueConcurrency: process.env.WS_PUSH_QUEUE_CONCURRENCY
  };

  beforeAll(async () => {
    process.env.WS_PUSH_PER_MESSAGE_MAX = '50';
    process.env.WS_PUSH_QUEUE_MAX_PENDING = '500';
    process.env.WS_PUSH_QUEUE_CONCURRENCY = '25';

    jest.resetModules();
    const socketModule = require('../socket') as {
      initializeSocket: InitializeSocketFn;
      getSocketHardeningMetrics: GetMetricsFn;
    };
    const fanoutModule = require('../socket-fanout-control') as {
      resetFanoutMetricsForTests: ResetFanoutFn;
    };
    const pushModule = require('../../modules/push/push.controller') as {
      notifyNewMessage: (userId: string, payload: unknown) => Promise<void>;
    };

    initializeSocketFn = socketModule.initializeSocket;
    getMetricsFn = socketModule.getSocketHardeningMetrics;
    resetFanoutFn = fanoutModule.resetFanoutMetricsForTests;
    notifyNewMessageSpy = jest.spyOn(pushModule, 'notifyNewMessage').mockResolvedValue(undefined);

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

    // Restore or delete — assigning undefined stringifies to "undefined" (truthy), which
    // breaks Number(...) parsing in modules loaded after this test via jest.resetModules().
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete (process.env as any)[key];
      else process.env[key] = value;
    });
    notifyNewMessageSpy.mockRestore();

    await prisma.user.deleteMany({
      where: { email: { contains: RUN_TAG } }
    });
  });

  beforeEach(() => {
    resetFanoutFn();
    notifyNewMessageSpy.mockClear();
  });

  it('caps push fanout on send-message when conversation has 200 members', async () => {
    const senderSession = await createTestSession(app);
    const receiverSession = await createTestSession(app);

    const sender = await getAccessToken({
      app,
      session: senderSession,
      email: `sender-${RUN_TAG}@test.com`,
      role: Role.RIDER,
      emailVerified: true
    });
    const receiver = await getAccessToken({
      app,
      session: receiverSession,
      email: `receiver-${RUN_TAG}@test.com`,
      role: Role.RIDER,
      emailVerified: true
    });

    await prisma.riderProfile.upsert({
      where: { userId: sender.userId },
      update: { displayName: 'sender' },
      create: { userId: sender.userId, displayName: 'sender' }
    });
    await prisma.riderProfile.upsert({
      where: { userId: receiver.userId },
      update: { displayName: 'receiver' },
      create: { userId: receiver.userId, displayName: 'receiver' }
    });

    const conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [{ userId: sender.userId }, { userId: receiver.userId }]
        }
      },
      select: { id: true }
    });

    const senderSocket = await connectClient(TEST_PORT, sender.accessToken);
    clients.push(senderSocket);

    const joinAck = await emitWithAck<{ ok: boolean }>(senderSocket, 'join-conversation', { conversationId: conversation.id });
    expect(joinAck.ok).toBe(true);

    const originalFindMany = prisma.conversationMember.findMany.bind(prisma.conversationMember);
    const fakeOtherMembers = Array.from({ length: 200 }, () => ({ userId: randomUUID() }));

    const findManySpy = jest.spyOn(prisma.conversationMember, 'findMany').mockImplementation(((args: any) => {
      if (args?.where?.conversationId === conversation.id && args?.select?.userId) {
        return Promise.resolve(fakeOtherMembers as any);
      }
      return originalFindMany(args);
    }) as any);

    const sendAck = await emitWithAck<{ ok: boolean }>(senderSocket, 'send-message', {
      conversationId: conversation.id,
      content: 'fanout-budget',
      type: 'TEXT'
    });

    expect(sendAck.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 300));
    findManySpy.mockRestore();

    const metrics = getMetricsFn().fanout;
    expect(notifyNewMessageSpy.mock.calls.length).toBeLessThanOrEqual(metrics.pushPerMessageMax);
    expect(metrics.pushDroppedByBudget).toBeGreaterThanOrEqual(150);
    expect(metrics.pushQueued).toBeLessThanOrEqual(metrics.pushPerMessageMax);
  }, 30000);
});
