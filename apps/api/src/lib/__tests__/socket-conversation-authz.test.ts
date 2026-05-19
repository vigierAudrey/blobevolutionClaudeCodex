import { createServer, type Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { Role, clientPrisma as prisma } from '@blobinfini/database';
import { createApp } from '../../index';
import { createTestSession, getAccessToken } from '../../tests/helpers/auth';

type JoinAck = { ok: true; data: { conversationId: string } } | { ok: false; error: { code: string; message: string } };
type SendAck = { ok: true; data: { conversationId: string; id: string } } | { ok: false; error: { code: string; message: string } };

const TEST_PORT = 4128;

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
      reconnection: false,
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

describe('Socket conversation authZ regression', () => {
  const app = createApp();
  const clients: ClientSocket[] = [];

  let httpServer: HttpServer;
  let socketServer: SocketIOServer;

  beforeAll(async () => {
    jest.resetModules();
    const socketModule = require('../socket') as {
      initializeSocket: (server: HttpServer) => SocketIOServer;
    };

    httpServer = createServer(app);
    socketServer = socketModule.initializeSocket(httpServer);
    await waitForServer(httpServer, TEST_PORT);
  });

  afterEach(() => {
    for (const client of clients) {
      try {
        client.disconnect();
      } catch {
        // ignore
      }
    }
    clients.length = 0;
  });

  afterAll(async () => {
    if (socketServer) socketServer.close();
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [
            'socket-authz-sender@test.com',
            'socket-authz-receiver@test.com',
            'socket-authz-intruder@test.com',
            'socket-authz-lost-sender@test.com',
            'socket-authz-lost-receiver@test.com',
          ],
        },
      },
    });
    await prisma.$disconnect();
  });

  it('refuse join-conversation et send-message pour un non-membre', async () => {
    const senderSession = await createTestSession(app);
    const receiverSession = await createTestSession(app);
    const intruderSession = await createTestSession(app);

    const sender = await getAccessToken({
      app,
      session: senderSession,
      email: 'socket-authz-sender@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const receiver = await getAccessToken({
      app,
      session: receiverSession,
      email: 'socket-authz-receiver@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const intruder = await getAccessToken({
      app,
      session: intruderSession,
      email: 'socket-authz-intruder@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await prisma.riderProfile.createMany({
      data: [
        { userId: sender.userId, displayName: 'Socket Sender' },
        { userId: receiver.userId, displayName: 'Socket Receiver' },
        { userId: intruder.userId, displayName: 'Socket Intruder' },
      ],
      skipDuplicates: true,
    });

    const conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [{ userId: sender.userId }, { userId: receiver.userId }],
        },
      },
      select: { id: true },
    });

    const memberSocket = await connectClient(TEST_PORT, sender.accessToken);
    const intruderSocket = await connectClient(TEST_PORT, intruder.accessToken);
    clients.push(memberSocket, intruderSocket);

    const memberJoinAck = await emitWithAck<JoinAck>(memberSocket, 'join-conversation', {
      conversationId: conversation.id,
    });
    expect(memberJoinAck.ok).toBe(true);

    const intruderJoinAck = await emitWithAck<JoinAck>(intruderSocket, 'join-conversation', {
      conversationId: conversation.id,
    });
    expect(intruderJoinAck.ok).toBe(false);
    if (!intruderJoinAck.ok) {
      expect(intruderJoinAck.error.code).toBe('FORBIDDEN');
    }

    const intruderSendAck = await emitWithAck<SendAck>(intruderSocket, 'send-message', {
      conversationId: conversation.id,
      content: 'forbidden-message',
      type: 'TEXT',
    });
    expect(intruderSendAck.ok).toBe(false);
    if (!intruderSendAck.ok) {
      expect(intruderSendAck.error.code).toBe('FORBIDDEN');
    }
  }, 30000);

  it('bloque send-message après perte de membership', async () => {
    const senderSession = await createTestSession(app);
    const receiverSession = await createTestSession(app);

    const sender = await getAccessToken({
      app,
      session: senderSession,
      email: 'socket-authz-lost-sender@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });
    const receiver = await getAccessToken({
      app,
      session: receiverSession,
      email: 'socket-authz-lost-receiver@test.com',
      role: Role.RIDER,
      emailVerified: true,
    });

    await prisma.riderProfile.createMany({
      data: [
        { userId: sender.userId, displayName: 'Socket Lost Sender' },
        { userId: receiver.userId, displayName: 'Socket Lost Receiver' },
      ],
      skipDuplicates: true,
    });

    const conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        type: 'RIDER_TO_RIDER',
        members: {
          create: [{ userId: sender.userId }, { userId: receiver.userId }],
        },
      },
      select: { id: true },
    });

    const senderSocket = await connectClient(TEST_PORT, sender.accessToken);
    clients.push(senderSocket);

    const joinAck = await emitWithAck<JoinAck>(senderSocket, 'join-conversation', {
      conversationId: conversation.id,
    });
    expect(joinAck.ok).toBe(true);

    await prisma.conversationMember.delete({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: sender.userId,
        } as any,
      },
    });

    const sendAck = await emitWithAck<SendAck>(senderSocket, 'send-message', {
      conversationId: conversation.id,
      content: 'message-after-membership-loss',
      type: 'TEXT',
    });

    expect(sendAck.ok).toBe(false);
    if (!sendAck.ok) {
      expect(sendAck.error.code).toBe('FORBIDDEN');
    }
  }, 30000);
});
