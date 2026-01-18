/**
 * Test d'intégration critique: WS timeout → HTTP fallback 200 (replay)
 *
 * Scénario réel:
 * 1. User sends message
 * 2. WS timeout
 * 3. HTTP fallback succeeds with 200 (replay detected by backend)
 * 4. Server emits new-message via WS (with clientMsgId)
 *
 * Résultat attendu:
 * ✅ 1 seul message affiché (pas de doublon)
 * ✅ Optimistic supprimé par clientMsgId
 * ✅ Reconciliation basée sur clientMsgId (strict)
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from '../useChat';
import { useSocket } from '../useSocket';
import { apiClient } from '../../lib/apiClient';

jest.mock('../useSocket');
jest.mock('../../lib/apiClient');

const mockUseSocket = useSocket as jest.MockedFunction<typeof useSocket>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('useChat - Integration: WS timeout → HTTP replay', () => {
  const conversationId = 'conv-integration-test';
  const token = 'test-token';

  let mockSocket: unknown;
  let mockEmit: jest.Mock;
  let mockOn: jest.Mock;
  let mockOff: jest.Mock;
  let onNewMessageCallback: ((msg: unknown) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    onNewMessageCallback = null;

    mockEmit = jest.fn();
    mockOn = jest.fn((event, handler) => {
      if (event === 'new-message') {
        onNewMessageCallback = handler;
      }
    });
    mockOff = jest.fn();

    mockSocket = {
      emit: mockEmit,
      on: mockOn,
      off: mockOff
    };

    mockUseSocket.mockReturnValue({
      socket: mockSocket,
      connected: true,
      lastSocketError: null,
      emit: mockEmit,
      on: mockOn,
      off: mockOff
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Test critique: WS timeout → HTTP 200 → Server push via WS
   * Vérifie que reconciliation par clientMsgId évite doublons
   */
  it('should avoid duplicate when WS timeout → HTTP 200 (replay) → Server push', async () => {
    const receivedMessages: unknown[] = [];
    const onNewMessage = jest.fn((msg) => {
      receivedMessages.push(msg);
    });

    const { result } = renderHook(() =>
      useChat({ conversationId, token, onNewMessage })
    );

    // Join conversation
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    // Setup: WS times out (don't call callback to simulate network timeout)
    const testClientMsgId = 'test-uuid-12345';
    mockEmit.mockImplementation((event, payload, callback) => {
      if (event === 'send-message') {
        // Capture clientMsgId from payload
        expect(payload.clientMsgId).toBe(testClientMsgId);

        // Simulate WS timeout: DON'T call callback (emitWithAck will timeout after 5s)
        // Callback intentionally not called to trigger CLIENT_TIMEOUT in emitWithAck
      }
      return mockSocket;
    });

    // Setup: HTTP fallback returns 200 (replay detected)
    mockApiClient.sendMessageWithStatus = jest.fn().mockResolvedValue({
      data: {
        id: 'msg-server-123',
        content: 'Test message',
        type: 'TEXT',
        createdAt: new Date().toISOString()
      },
      status: 200 // Replay detected by backend
    });

    // User sends message
    let sendPromise: Promise<any>;
    act(() => {
      sendPromise = result.current.sendMessage('Test message', 'TEXT', undefined, testClientMsgId);
    });

    // Advance timers to trigger WS timeout (default 5000ms)
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // HTTP fallback should succeed with created:false
    const sendResult = await sendPromise;
    expect(sendResult).toEqual({
      success: true,
      transport: 'HTTP',
      clientMsgId: testClientMsgId,
      created: false // 200 = replay
    });

    // Simulate server emitting new-message via WS (with clientMsgId)
    // This would happen after HTTP 200 if backend broadcasts message
    act(() => {
      if (onNewMessageCallback) {
        onNewMessageCallback({
          id: 'msg-server-123',
          conversationId,
          senderId: 'user-123',
          type: 'TEXT',
          content: 'Test message',
          createdAt: new Date().toISOString(),
          clientMsgId: testClientMsgId // CRITICAL: same clientMsgId
        });
      }
    });

    await waitFor(() => {
      // Verify: exactly 1 message received (no duplicate)
      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].content).toBe('Test message');
      expect(receivedMessages[0].clientMsgId).toBe(testClientMsgId);
    });

    // Verify: onNewMessage called exactly once (deduplication worked)
    expect(onNewMessage).toHaveBeenCalledTimes(1);
  });

  /**
   * Test: WS success → Server push with same clientMsgId
   * Vérifie que reconciliation par clientMsgId fonctionne aussi pour WS
   */
  it('should reconcile by clientMsgId when WS succeeds and server pushes', async () => {
    const receivedMessages: unknown[] = [];
    const onNewMessage = jest.fn((msg) => {
      receivedMessages.push(msg);
    });

    const { result } = renderHook(() =>
      useChat({ conversationId, token, onNewMessage })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    const testClientMsgId = 'test-uuid-67890';
    let sendAckCallback: unknown;

    mockEmit.mockImplementation((event, payload, callback) => {
      if (event === 'send-message') {
        sendAckCallback = callback;
        expect(payload.clientMsgId).toBe(testClientMsgId);
      }
      return mockSocket;
    });

    // Send message
    let sendPromise: Promise<any>;
    act(() => {
      sendPromise = result.current.sendMessage('WS message', 'TEXT', undefined, testClientMsgId);
    });

    // WS ACK succeeds
    act(() => {
      sendAckCallback?.({
        ok: true,
        data: {
          id: 'msg-ws-456',
          conversationId,
          content: 'WS message',
          type: 'TEXT',
          createdAt: new Date().toISOString(),
          created: true
        }
      });
    });

    await expect(sendPromise).resolves.toMatchObject({
      success: true,
      transport: 'WS',
      clientMsgId: testClientMsgId
    });

    // Server broadcasts message via new-message event
    act(() => {
      if (onNewMessageCallback) {
        onNewMessageCallback({
          id: 'msg-ws-456',
          conversationId,
          senderId: 'user-123',
          type: 'TEXT',
          content: 'WS message',
          createdAt: new Date().toISOString(),
          clientMsgId: testClientMsgId // Same clientMsgId
        });
      }
    });

    await waitFor(() => {
      // Should receive message exactly once
      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].clientMsgId).toBe(testClientMsgId);
    });

    expect(onNewMessage).toHaveBeenCalledTimes(1);
  });

  /**
   * Test: Multiple messages with different clientMsgIds
   * Vérifie que chaque message est distinct
   */
  it('should handle multiple messages with different clientMsgIds correctly', async () => {
    const receivedMessages: unknown[] = [];
    const onNewMessage = jest.fn((msg) => {
      receivedMessages.push(msg);
    });

    const { result } = renderHook(() =>
      useChat({ conversationId, token, onNewMessage })
    );

    // Join
    const joinAckCallback = mockEmit.mock.calls.find(
      (call) => call[0] === 'join-conversation'
    )?.[2];
    act(() => {
      joinAckCallback?.({ ok: true, data: { conversationId } });
    });

    const clientMsgId1 = 'uuid-msg-1';
    const clientMsgId2 = 'uuid-msg-2';

    let ackCallbacks: unknown[] = [];
    mockEmit.mockImplementation((event, payload, callback) => {
      if (event === 'send-message') {
        ackCallbacks.push({ clientMsgId: payload.clientMsgId, callback });
      }
      return mockSocket;
    });

    // Send first message
    let promise1: Promise<any>;
    act(() => {
      promise1 = result.current.sendMessage('First', 'TEXT', undefined, clientMsgId1);
    });

    // Send second message
    let promise2: Promise<any>;
    act(() => {
      promise2 = result.current.sendMessage('Second', 'TEXT', undefined, clientMsgId2);
    });

    // ACK both
    act(() => {
      ackCallbacks[0].callback({
        ok: true,
        data: {
          id: 'msg-1',
          conversationId,
          content: 'First',
          type: 'TEXT',
          createdAt: new Date().toISOString(),
          created: true
        }
      });

      ackCallbacks[1].callback({
        ok: true,
        data: {
          id: 'msg-2',
          conversationId,
          content: 'Second',
          type: 'TEXT',
          createdAt: new Date().toISOString(),
          created: true
        }
      });
    });

    await Promise.all([promise1, promise2]);

    // Server pushes both messages
    act(() => {
      if (onNewMessageCallback) {
        onNewMessageCallback({
          id: 'msg-1',
          conversationId,
          senderId: 'user-123',
          type: 'TEXT',
          content: 'First',
          createdAt: new Date().toISOString(),
          clientMsgId: clientMsgId1
        });

        onNewMessageCallback({
          id: 'msg-2',
          conversationId,
          senderId: 'user-123',
          type: 'TEXT',
          content: 'Second',
          createdAt: new Date().toISOString(),
          clientMsgId: clientMsgId2
        });
      }
    });

    await waitFor(() => {
      // Should have exactly 2 distinct messages
      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].clientMsgId).toBe(clientMsgId1);
      expect(receivedMessages[1].clientMsgId).toBe(clientMsgId2);
    });

    expect(onNewMessage).toHaveBeenCalledTimes(2);
  });
});
