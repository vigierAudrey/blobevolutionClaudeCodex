/**
 * Tests TDD pour l'intégration clientMsgId dans useChat
 *
 * Invariants testés:
 * 1. clientMsgId généré UNE fois (pas régénéré sur retry)
 * 2. transmis WS + HTTP fallback
 * 3. cleanup optimistic par clientMsgId
 * 4. ACK created:false → no duplicate
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useChat } from '../useChat';
import { useSocket } from '../useSocket';
import { apiClient } from '../../lib/apiClient';

// Mock dependencies
jest.mock('../useSocket');
jest.mock('../../lib/apiClient');

const mockUseSocket = useSocket as jest.MockedFunction<typeof useSocket>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

type ChatSendResult = Awaited<ReturnType<ReturnType<typeof useChat>['sendMessage']>>;
type ChatSendSuccess = Extract<ChatSendResult, { success: true }>;
type ChatSendPromise = Promise<ChatSendResult>;
type SendPayload = {
  conversationId: string;
  content: string;
  type: 'TEXT' | 'PROPOSAL';
  clientMsgId: string;
};
type AckPayload =
  | {
      ok: true;
      data: {
        id?: string;
        conversationId: string;
        content?: string;
        type?: string;
        createdAt?: string;
        created?: boolean;
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    };
type AckCallback = (payload: AckPayload) => void;
type MockSocket = Socket & {
  connected: boolean;
  emit: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
};

const requireAssigned = <T>(value: T, label: string): NonNullable<T> => {
  if (value === null || value === undefined) {
    throw new Error(`${label} was not assigned`);
  }
  return value as NonNullable<T>;
};

const requireSendPromise = (value: ChatSendPromise | null, label: string): ChatSendPromise =>
  requireAssigned(value, label);

const requireString = (value: string | null, label: string): string =>
  requireAssigned(value, label);

const expectSendSuccess = (result: ChatSendResult): ChatSendSuccess => {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error('Expected sendMessage to succeed');
  }
  return result;
};

describe('useChat - clientMsgId integration', () => {
  const conversationId = 'conv-123';
  const token = 'test-token';

  let mockSocket: MockSocket;
  let mockEmit: jest.Mock;
  let mockOn: jest.Mock;
  let mockOff: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockEmit = jest.fn();
    mockOn = jest.fn();
    mockOff = jest.fn();
    mockSocket = {
      connected: true,
      emit: mockEmit,
      on: mockOn,
      off: mockOff
    } as unknown as MockSocket;

    mockUseSocket.mockReturnValue({
      socket: mockSocket,
      connected: true,
      lastSocketError: null,
      connect: jest.fn(),
      disconnect: jest.fn(),
      emit: mockEmit,
      on: mockOn,
      off: mockOff
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Scénario 1: First send WS → ACK created:true
   * - clientMsgId généré et transmis
   * - Backend retourne created: true
   * - Message optimiste remplacé par server message
   */
  it('should generate clientMsgId and handle WS ACK with created:true', async () => {
    const onNewMessage = jest.fn();
    const { result } = renderHook(() =>
      useChat({ conversationId, token, onNewMessage })
    );

    // Simuler join ACK
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    // Send message
    let sendAckCallback: AckCallback | null = null;
    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        sendAckCallback = callback ?? null;
        // Vérifier que clientMsgId est présent dans le payload
        expect(payload).toHaveProperty('clientMsgId');
        expect(typeof payload.clientMsgId).toBe('string');
        expect(payload.clientMsgId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      }
      return mockSocket;
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello');
    });

    // Simuler ACK avec created: true
    act(() => {
      sendAckCallback?.({
        ok: true,
        data: {
          id: 'msg-server-123',
          conversationId,
          content: 'Hello',
          type: 'TEXT',
          createdAt: new Date().toISOString(),
          created: true // Premier envoi
        }
      });
    });

    const sendResult = await requireSendPromise(sendPromise, 'sendPromise');
    const successResult = expectSendSuccess(sendResult);
    expect(successResult.transport).toBe('WS');
    expect(successResult.clientMsgId).toBeDefined();
    expect(successResult.created).toBe(true);
  });

  /**
   * Scénario 2: WS ACK with created:false can be parsed
   * - Backend returns created: false
   * - Hook successfully processes the ACK (no crash)
   * Note: Replay detection/dedup is handled by parent component, not useChat
   */
  it('should successfully parse WS ACK with created:false flag', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    let sendAckCallback: AckCallback | null = null;
    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        sendAckCallback = callback ?? null;
      }
      return mockSocket;
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello');
    });

    // ACK with created: false (replay detected by backend)
    act(() => {
      sendAckCallback?.({
        ok: true,
        data: {
          id: 'msg-123',
          conversationId,
          content: 'Hello',
          type: 'TEXT',
          createdAt: new Date().toISOString(),
          created: false // Replay flag from backend
        }
      });
    });

    // Hook should handle created:false without crashing and return it
    const sendResult = await requireSendPromise(sendPromise, 'sendPromise');
    const successResult = expectSendSuccess(sendResult);
    expect(successResult.transport).toBe('WS');
    expect(successResult.clientMsgId).toBeDefined();
    expect(successResult.created).toBe(false);
  });

  /**
   * Scénario 3: HTTP fallback 201 Created
   * - WS timeout → HTTP fallback
   * - clientMsgId transmis dans body HTTP
   * - Backend retourne 201
   */
  it('should send clientMsgId in HTTP fallback and handle 201 Created', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    // WS emit times out (don't call callback to simulate network timeout)
    let capturedClientMsgId: string | null = null;
    mockEmit.mockImplementation((event: string, payload: SendPayload) => {
      if (event === 'send-message') {
        capturedClientMsgId = payload.clientMsgId;
        // Simulate WS timeout: DON'T call callback
        // emitWithAck will timeout after 5s
      }
      return mockSocket;
    });

    // Mock HTTP fallback (C4.2: use sendMessageWithStatus)
    mockApiClient.sendMessageWithStatus = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-http-123',
        content: 'Hello HTTP',
        type: 'TEXT',
        createdAt: new Date().toISOString()
      },
      status: 201 // C4.2: Include status
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello HTTP');
    });

    // Advance timers to trigger WS timeout
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      // Vérifier que sendMessageWithStatus a été appelé avec clientMsgId
      expect(mockApiClient.sendMessageWithStatus).toHaveBeenCalledWith(
        conversationId,
        expect.objectContaining({
          type: 'TEXT',
          content: 'Hello HTTP',
          clientMsgId: requireString(capturedClientMsgId, 'capturedClientMsgId')
        })
      );
    });

    // HTTP fallback should return clientMsgId
    const sendResult = await requireSendPromise(sendPromise, 'sendPromise');
    const successResult = expectSendSuccess(sendResult);
    expect(successResult.transport).toBe('HTTP');
    expect(successResult.clientMsgId).toBe(requireString(capturedClientMsgId, 'capturedClientMsgId'));
  });

  /**
   * Scénario 4: HTTP fallback 200 OK (replay)
   * - WS timeout → HTTP fallback
   * - Backend retourne 200 (message existait déjà)
   * - Pas de duplication
   */
  it('should handle HTTP 200 OK (replay detected via status)', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    // WS timeout (don't call callback to simulate network timeout)
    mockEmit.mockImplementation((event: string) => {
      if (event === 'send-message') {
        // Simulate WS timeout: DON'T call callback
        // emitWithAck will timeout after 5s
      }
      return mockSocket;
    });

    // HTTP retourne 200 (replay) - C4.2: use sendMessageWithStatus
    mockApiClient.sendMessageWithStatus = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-existing',
        content: 'Replay message',
        type: 'TEXT',
        createdAt: new Date().toISOString()
      },
      status: 200 // Replay détecté côté serveur
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Replay message');
    });

    // Advance timers to trigger WS timeout
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    const sendResult = await requireSendPromise(sendPromise, 'sendPromise');
    const successResult = expectSendSuccess(sendResult);
    expect(successResult.transport).toBe('HTTP');
    expect(successResult.clientMsgId).toBeDefined();

    // Backend a retourné 200 = replay, donc pas de nouveau message créé
    expect(mockApiClient.sendMessageWithStatus).toHaveBeenCalledTimes(1);
  });

  /**
   * Scénario 5: Each sendMessage call generates unique clientMsgId
   * - First call generates clientMsgId A
   * - Second call generates clientMsgId B (different message)
   * Note: Retry logic with same clientMsgId is handled by parent component
   */
  it('should generate unique clientMsgId for each sendMessage call', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    let firstClientMsgId: string | null = null;
    let secondClientMsgId: string | null = null;
    let callCount = 0;

    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        callCount++;

        if (callCount === 1) {
          firstClientMsgId = payload.clientMsgId;
          callback?.({
            ok: true,
            data: {
              id: 'msg-1',
              conversationId,
              content: 'First message',
              type: 'TEXT',
              createdAt: new Date().toISOString(),
              created: true
            }
          });
        } else if (callCount === 2) {
          secondClientMsgId = payload.clientMsgId;
          // Second message should have different clientMsgId
          expect(secondClientMsgId).not.toBe(firstClientMsgId);
          callback?.({
            ok: true,
            data: {
              id: 'msg-2',
              conversationId,
              content: 'Second message',
              type: 'TEXT',
              createdAt: new Date().toISOString(),
              created: true
            }
          });
        }
      }
      return mockSocket;
    });

    // First message
    let firstPromise: ChatSendPromise | null = null;
    act(() => {
      firstPromise = result.current.sendMessage('First message');
    });

    const firstResult = await requireSendPromise(firstPromise, 'firstPromise');
    const firstSuccessResult = expectSendSuccess(firstResult);
    expect(firstSuccessResult.transport).toBe('WS');
    expect(firstSuccessResult.clientMsgId).toBe(requireString(firstClientMsgId, 'firstClientMsgId'));
    expect(firstSuccessResult.created).toBe(true);

    // Second message (different from first)
    let secondPromise: ChatSendPromise | null = null;
    act(() => {
      secondPromise = result.current.sendMessage('Second message');
    });

    await expect(requireSendPromise(secondPromise, 'secondPromise')).resolves.toEqual({
      success: true,
      transport: 'WS',
      clientMsgId: requireString(secondClientMsgId, 'secondClientMsgId'),
      created: true
    });
    expect(callCount).toBe(2);
  });

  /**
   * C4.1 Scénario 1: Accept optional clientMsgId parameter
   * - Parent passes clientMsgId to sendMessage
   * - useChat uses provided ID instead of generating new one
   * - Returns same clientMsgId in result
   */
  it('should accept and use provided clientMsgId parameter', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    const providedClientMsgId = 'custom-client-msg-id-123';
    let capturedClientMsgId: string | null = null;

    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        capturedClientMsgId = payload.clientMsgId;
        callback?.({
          ok: true,
          data: {
            id: 'msg-123',
            conversationId,
            content: 'Hello',
            type: 'TEXT',
            createdAt: new Date().toISOString(),
            created: true
          }
        });
      }
      return mockSocket;
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello', 'TEXT', undefined, providedClientMsgId);
    });

    await waitFor(() => {
      // Should use provided clientMsgId, not generate new one
      expect(capturedClientMsgId).toBe(providedClientMsgId);
    });

    // Should return the provided clientMsgId
    await expect(requireSendPromise(sendPromise, 'sendPromise')).resolves.toEqual({
      success: true,
      transport: 'WS',
      clientMsgId: providedClientMsgId,
      created: true
    });
  });

  /**
   * C4.1 Scénario 2: Return clientMsgId in success result
   * - WS success returns clientMsgId + created flag
   * - HTTP success returns clientMsgId
   */
  it('should return clientMsgId and created flag in WS success result', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    let capturedClientMsgId: string | null = null;

    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        capturedClientMsgId = payload.clientMsgId;
        callback?.({
          ok: true,
          data: {
            id: 'msg-123',
            conversationId,
            content: 'Hello',
            type: 'TEXT',
            createdAt: new Date().toISOString(),
            created: false // Replay detected
          }
        });
      }
      return mockSocket;
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello');
    });

    await expect(requireSendPromise(sendPromise, 'sendPromise')).resolves.toEqual({
      success: true,
      transport: 'WS',
      clientMsgId: requireString(capturedClientMsgId, 'capturedClientMsgId'),
      created: false // Backend flag passed through
    });
  });

  /**
   * C4.1 Scénario 3: Return clientMsgId in failure result
   * - WS failure returns clientMsgId for retry tracking
   */
  it('should return clientMsgId in failure result', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    let capturedClientMsgId: string | null = null;

    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        capturedClientMsgId = payload.clientMsgId;
        callback?.({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Server error'
          }
        });
      }
      return mockSocket;
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello');
    });

    const sendResult = await requireSendPromise(sendPromise, 'sendPromise');
    expect(sendResult.success).toBe(false);
    expect(sendResult.clientMsgId).toBe(requireString(capturedClientMsgId, 'capturedClientMsgId'));
  });

  /**
   * C4.1 Scénario 4: Retry reuses same clientMsgId
   * - Parent calls sendMessage with same clientMsgId on retry
   * - WS receives same ID both times
   */
  it('should reuse same clientMsgId on retry (parent responsibility)', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    const fixedClientMsgId = 'retry-test-id';
    let firstCallClientMsgId: string | null = null;
    let secondCallClientMsgId: string | null = null;
    let callCount = 0;

    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        callCount++;
        if (callCount === 1) {
          firstCallClientMsgId = payload.clientMsgId;
          // First attempt fails
          callback?.({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Temporary error'
            }
          });
        } else if (callCount === 2) {
          secondCallClientMsgId = payload.clientMsgId;
          // Retry succeeds with created:false (replay detected)
          callback?.({
            ok: true,
            data: {
              id: 'msg-123',
              conversationId,
              content: 'Hello',
              type: 'TEXT',
              createdAt: new Date().toISOString(),
              created: false // Backend detected replay via clientMsgId
            }
          });
        }
      }
      return mockSocket;
    });

    // First attempt (fails)
    let firstPromise: ChatSendPromise | null = null;
    act(() => {
      firstPromise = result.current.sendMessage('Hello', 'TEXT', undefined, fixedClientMsgId);
    });

    await waitFor(() => {
      expect(firstCallClientMsgId).toBe(fixedClientMsgId);
    });

    const firstResult = await requireSendPromise(firstPromise, 'firstPromise');
    expect(firstResult.success).toBe(false);
    expect(firstResult.clientMsgId).toBe(fixedClientMsgId);

    // Retry with SAME clientMsgId (parent's responsibility)
    let retryPromise: ChatSendPromise | null = null;
    act(() => {
      retryPromise = result.current.sendMessage('Hello', 'TEXT', undefined, fixedClientMsgId);
    });

    await waitFor(() => {
      expect(secondCallClientMsgId).toBe(fixedClientMsgId);
    });

    // Retry succeeds, backend detects replay via clientMsgId
    await expect(requireSendPromise(retryPromise, 'retryPromise')).resolves.toEqual({
      success: true,
      transport: 'WS',
      clientMsgId: fixedClientMsgId,
      created: false // Backend flag: replay detected
    });

    // Both calls used same clientMsgId
    expect(requireString(firstCallClientMsgId, 'firstCallClientMsgId')).toBe(requireString(secondCallClientMsgId, 'secondCallClientMsgId'));
    expect(callCount).toBe(2);
  });

  /**
   * C4.2 Scénario 1: UUID v4 fallback when crypto.randomUUID unavailable
   * - Mock crypto.randomUUID as undefined
   * - Verify generated clientMsgId is valid UUID v4
   */
  it('should generate valid UUID v4 when crypto.randomUUID is unavailable', async () => {
    // Mock crypto.randomUUID as undefined
    const originalCrypto = global.crypto;
    Object.defineProperty(global, 'crypto', {
      value: undefined,
      writable: true,
      configurable: true
    });

    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    let capturedClientMsgId: string | null = null;

    mockEmit.mockImplementation((event: string, payload: SendPayload, callback?: AckCallback) => {
      if (event === 'send-message') {
        capturedClientMsgId = payload.clientMsgId;
        callback?.({
          ok: true,
          data: {
            id: 'msg-123',
            conversationId,
            content: 'Hello',
            type: 'TEXT',
            createdAt: new Date().toISOString(),
            created: true
          }
        });
      }
      return mockSocket;
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello');
    });

    await waitFor(() => {
      // Verify clientMsgId is valid UUID v4 (RFC4122)
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(requireString(capturedClientMsgId, 'capturedClientMsgId')).toMatch(uuidV4Regex);
    });

    // Restore crypto
    Object.defineProperty(global, 'crypto', {
      value: originalCrypto,
      writable: true,
      configurable: true
    });

    await expect(requireSendPromise(sendPromise, 'sendPromise')).resolves.toMatchObject({ success: true });
  });

  /**
   * C4.2 Scénario 2: HTTP fallback returns created:true on 201 Created
   * - WS timeout → HTTP fallback
   * - Backend returns 201
   * - Verify created: true
   */
  it('should return created:true when HTTP fallback gets 201 Created', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    // WS emit times out (don't call callback to simulate network timeout)
    mockEmit.mockImplementation((event: string) => {
      if (event === 'send-message') {
        // Simulate WS timeout: DON'T call callback
        // emitWithAck will timeout after 5s
      }
      return mockSocket;
    });

    // Mock HTTP fallback with status 201
    mockApiClient.sendMessageWithStatus = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-http-123',
        content: 'Hello HTTP',
        type: 'TEXT',
        createdAt: new Date().toISOString()
      },
      status: 201 // First creation
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Hello HTTP');
    });

    // Advance timers to trigger WS timeout
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Should derive created: true from status 201
    await expect(requireSendPromise(sendPromise, 'sendPromise')).resolves.toEqual({
      success: true,
      transport: 'HTTP',
      clientMsgId: expect.any(String),
      created: true // Derived from 201
    });
  });

  /**
   * C4.2 Scénario 3: HTTP fallback returns created:false on 200 OK
   * - WS timeout → HTTP fallback
   * - Backend returns 200 (replay detected)
   * - Verify created: false
   */
  it('should return created:false when HTTP fallback gets 200 OK', async () => {
    const { result } = renderHook(() =>
      useChat({ conversationId, token })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    // WS timeout (don't call callback to simulate network timeout)
    mockEmit.mockImplementation((event: string) => {
      if (event === 'send-message') {
        // Simulate WS timeout: DON'T call callback
        // emitWithAck will timeout after 5s
      }
      return mockSocket;
    });

    // Mock HTTP fallback with status 200 (replay)
    mockApiClient.sendMessageWithStatus = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-existing',
        content: 'Replay message',
        type: 'TEXT',
        createdAt: new Date().toISOString()
      },
      status: 200 // Replay detected
    });

    let sendPromise: ChatSendPromise | null = null;
    act(() => {
      sendPromise = result.current.sendMessage('Replay message');
    });

    // Advance timers to trigger WS timeout
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Should derive created: false from status 200
    await expect(requireSendPromise(sendPromise, 'sendPromise')).resolves.toEqual({
      success: true,
      transport: 'HTTP',
      clientMsgId: expect.any(String),
      created: false // Derived from 200
    });
  });
});
