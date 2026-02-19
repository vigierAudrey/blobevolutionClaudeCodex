import { createServer, type Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { Role, clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../index';
import { createTestSession, getAccessToken } from '../../tests/helpers/auth';

const TEST_PORT = 4114;
const RUN_TAG = `ws-typing-flood-${Date.now()}`;

type InitializeSocketFn = (httpServer: HttpServer) => SocketIOServer;
type SocketRateLimitModule = {
  getTypingLimiter: () => {
    consume: (key: string) => Promise<unknown>;
  };
};

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

async function expectNoEvent(socket: ClientSocket, event: string, trigger: () => void, waitMs = 800): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handler = () => {
      clearTimeout(timer);
      socket.off(event, handler);
      reject(new Error(`Unexpected event received: ${event}`));
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, waitMs);

    socket.once(event, handler);
    trigger();
  });
}

describe('Socket typing limiter fail-closed (P1)', () => {
  const app = createApp();
  const createdConversationIds: string[] = [];
  const clients: ClientSocket[] = [];

  let httpServer: HttpServer;
  let socketServer: SocketIOServer;
  let initializeSocketFn: InitializeSocketFn;
  let socketRateLimitModule: SocketRateLimitModule;
  let previousRateLimitFlag: string | undefined;

  beforeAll(async () => {
    previousRateLimitFlag = process.env.ENABLE_WEBSOCKET_RATE_LIMIT;
    process.env.ENABLE_WEBSOCKET_RATE_LIMIT = 'true';

    jest.resetModules();
    const socketModule = require('../socket') as { initializeSocket: InitializeSocketFn };
    initializeSocketFn = socketModule.initializeSocket as InitializeSocketFn;
    socketRateLimitModule = require('../socket-rate-limit') as SocketRateLimitModule;

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

    if (createdConversationIds.length > 0) {
      await prisma.conversation.deleteMany({
        where: { id: { in: createdConversationIds } }
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

  it('blocks typing emit when limiter fails internally', async () => {
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
          create: [
            { userId: sender.userId },
            { userId: receiver.userId }
          ]
        }
      },
      select: { id: true }
    });
    createdConversationIds.push(conversation.id);

    const senderSocket = await connectClient(TEST_PORT, sender.accessToken);
    const receiverSocket = await connectClient(TEST_PORT, receiver.accessToken);
    clients.push(senderSocket, receiverSocket);

    const joinAckSender = await emitWithAck<{ ok: boolean }>(senderSocket, 'join-conversation', { conversationId: conversation.id });
    const joinAckReceiver = await emitWithAck<{ ok: boolean }>(receiverSocket, 'join-conversation', { conversationId: conversation.id });
    expect(joinAckSender.ok).toBe(true);
    expect(joinAckReceiver.ok).toBe(true);

    const typingLimiter = socketRateLimitModule.getTypingLimiter();
    const consumeSpy = jest.spyOn(typingLimiter, 'consume').mockRejectedValue(new Error('typing limiter unavailable'));

    await expectNoEvent(
      receiverSocket,
      'user-typing',
      () => {
        senderSocket.emit('typing', { conversationId: conversation.id, isTyping: true });
      },
      1000
    );

    expect(consumeSpy).toHaveBeenCalled();
    consumeSpy.mockRestore();
  });
});
