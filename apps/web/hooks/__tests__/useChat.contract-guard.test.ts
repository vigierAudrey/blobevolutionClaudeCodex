/**
 * Contract Drift Guard Test (C4.4 + C4.4.2 - Behavioral)
 *
 * Guard test that fails if clientMsgId contract breaks.
 * Uses behavioral testing instead of fragile string matching.
 *
 * CRITICAL: If this test fails, clientMsgId idempotence is broken!
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from '../useChat';
import { useSocket } from '../useSocket';
import { emitWithAck } from '../../lib/emitWithAck';
import { apiClient } from '../../lib/apiClient';

jest.mock('../useSocket');
jest.mock('../../lib/emitWithAck');
jest.mock('../../lib/apiClient', () => ({
  apiClient: {
    sendMessage: jest.fn(),
    sendMessageWithStatus: jest.fn(),
  },
}));

type ChatSendResult = Awaited<ReturnType<ReturnType<typeof useChat>['sendMessage']>>;

const requireAssigned = <T>(value: T, label: string): NonNullable<T> => {
  if (value === null || value === undefined) {
    throw new Error(`${label} was not assigned`);
  }
  return value as NonNullable<T>;
};

const requireSendResult = (value: ChatSendResult | null, label: string): ChatSendResult =>
  requireAssigned(value, label);

describe('clientMsgId Contract Behavioral Guards', () => {
  const conversationId = 'contract-test-conv';
  const token = 'test-token';
  const FIXED_CLIENT_MSG_ID = 'fixed-uuid-12345';

  let mockSocket: { connected: boolean; emit: jest.Mock; on: jest.Mock; off: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockSocket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    (useSocket as jest.Mock).mockReturnValue({
      socket: mockSocket,
      connected: true,
      lastSocketError: null,
      emit: mockSocket.emit,
      on: mockSocket.on,
      off: mockSocket.off,
    });

    (emitWithAck as jest.Mock).mockResolvedValue({ conversationId });
  });

  /**
   * Guard #1: WS payload must include clientMsgId
   * Behavioral test: mock emitWithAck, inspect actual payload passed
   */
  it('should transmit clientMsgId in WS send-message payload', async () => {
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId }) // join
      .mockResolvedValueOnce({ id: 'msg-1', conversationId, content: 'test', type: 'TEXT', createdAt: new Date().toISOString() }); // send

    const { result } = renderHook(() => useChat({ conversationId, token }));

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1)); // join

    await act(async () => {
      await result.current.sendMessage('test', 'TEXT', undefined, FIXED_CLIENT_MSG_ID);
    });

    // Verify emitWithAck was called with 'send-message' event
    const sendMessageCall = (emitWithAck as jest.Mock).mock.calls.find(
      (call) => call[1] === 'send-message'
    );

    expect(sendMessageCall).toBeTruthy();

    // Verify payload includes clientMsgId
    const payload = sendMessageCall[2];
    expect(payload).toHaveProperty('clientMsgId', FIXED_CLIENT_MSG_ID);
    expect(payload).toMatchObject({
      conversationId,
      content: 'test',
      type: 'TEXT',
      clientMsgId: FIXED_CLIENT_MSG_ID,
    });
  });

  /**
   * Guard #2: HTTP fallback must include clientMsgId
   * Behavioral test: mock sendMessageWithStatus, inspect body passed
   */
  it('should transmit clientMsgId in HTTP fallback body', async () => {
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId }) // join
      .mockRejectedValueOnce({ code: 'CLIENT_TIMEOUT', message: 'Timeout' }); // send WS timeout

    (apiClient.sendMessageWithStatus as jest.Mock).mockResolvedValue({
      data: { id: 'msg-http', conversationId, content: 'test', type: 'TEXT', createdAt: new Date().toISOString() },
      status: 201,
    });

    const { result } = renderHook(() => useChat({ conversationId, token }));

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1)); // join

    await act(async () => {
      await result.current.sendMessage('test', 'TEXT', undefined, FIXED_CLIENT_MSG_ID);
    });

    // Verify sendMessageWithStatus was called
    expect(apiClient.sendMessageWithStatus).toHaveBeenCalledTimes(1);

    // Verify HTTP body includes clientMsgId
    const httpCallArgs = (apiClient.sendMessageWithStatus as jest.Mock).mock.calls[0];
    expect(httpCallArgs[0]).toBe(conversationId);
    expect(httpCallArgs[1]).toMatchObject({
      type: 'TEXT',
      content: 'test',
      clientMsgId: FIXED_CLIENT_MSG_ID,
    });
  });

  /**
   * Guard #3: sendMessage must accept optional clientMsgId parameter
   * Behavioral test: call with provided clientMsgId and verify it's used
   */
  it('should accept optional clientMsgId parameter in sendMessage', async () => {
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId }) // join
      .mockResolvedValueOnce({ id: 'msg-1', conversationId, content: 'test', type: 'TEXT', createdAt: new Date().toISOString() }); // send

    const { result } = renderHook(() => useChat({ conversationId, token }));

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    // Call with provided clientMsgId
    let sendResult: ChatSendResult | null = null;
    await act(async () => {
      sendResult = await result.current.sendMessage('test', 'TEXT', undefined, FIXED_CLIENT_MSG_ID);
    });

    // Verify the fixed clientMsgId was propagated to WS
    const sendCall = (emitWithAck as jest.Mock).mock.calls.find(
      (call) => call[1] === 'send-message'
    );
    expect(sendCall[2].clientMsgId).toBe(FIXED_CLIENT_MSG_ID);
  });

  /**
   * Guard #4: sendMessage result must include clientMsgId
   * Behavioral test: call sendMessage and verify result contains clientMsgId
   */
  it('should return clientMsgId in sendMessage result', async () => {
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId }) // join
      .mockResolvedValueOnce({ id: 'msg-1', conversationId, content: 'test', type: 'TEXT', createdAt: new Date().toISOString() }); // send

    const { result } = renderHook(() => useChat({ conversationId, token }));

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult: ChatSendResult | null = null;
    await act(async () => {
      sendResult = await result.current.sendMessage('test', 'TEXT', undefined, FIXED_CLIENT_MSG_ID);
    });

    // Verify result includes clientMsgId
    expect(sendResult).toMatchObject({
      success: true,
      transport: 'WS',
      clientMsgId: FIXED_CLIENT_MSG_ID,
    });
  });

  /**
   * Guard #5: HTTP fallback result must include clientMsgId
   * Behavioral test: trigger HTTP fallback and verify result contains clientMsgId
   */
  it('should return clientMsgId in HTTP fallback result', async () => {
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId }) // join
      .mockRejectedValueOnce({ code: 'CLIENT_TIMEOUT', message: 'Timeout' }); // send WS timeout

    (apiClient.sendMessageWithStatus as jest.Mock).mockResolvedValue({
      data: { id: 'msg-http', conversationId, content: 'test', type: 'TEXT', createdAt: new Date().toISOString() },
      status: 201,
    });

    const { result } = renderHook(() => useChat({ conversationId, token }));

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage('test', 'TEXT', undefined, FIXED_CLIENT_MSG_ID);
    });

    // Verify HTTP fallback result includes clientMsgId
    expect(sendResult).toMatchObject({
      success: true,
      transport: 'HTTP',
      clientMsgId: FIXED_CLIENT_MSG_ID,
      created: true, // 201 = created
    });
  });

  /**
   * Guard #6: Failure result must include clientMsgId
   * Behavioral test: trigger failure and verify result contains clientMsgId
   */
  it('should return clientMsgId even in failure result', async () => {
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId }) // join
      .mockRejectedValueOnce({ code: 'FORBIDDEN', message: 'Access denied' }); // send fails

    const { result } = renderHook(() => useChat({ conversationId, token }));

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult: ChatSendResult | null = null;
    await act(async () => {
      sendResult = await result.current.sendMessage('test', 'TEXT', undefined, FIXED_CLIENT_MSG_ID);
    });

    // Verify failure result includes clientMsgId
    const failureResult = requireSendResult(sendResult, 'sendResult');
    expect(failureResult).toMatchObject({
      success: false,
      clientMsgId: FIXED_CLIENT_MSG_ID,
    });

    if (!failureResult.success) {
      expect(failureResult.clientMsgId).toBe(FIXED_CLIENT_MSG_ID);
    }
  });
});
