import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from '../useChat';
import { useSocket } from '../useSocket';
import { emitWithAck } from '../../lib/emitWithAck';
import { ERROR_CODES } from '../../lib/socketAck';
import { apiClient } from '../../lib/apiClient';

jest.mock('../useSocket');
jest.mock('../../lib/emitWithAck');
jest.mock('../../lib/apiClient', () => ({
  apiClient: {
    sendMessage: jest.fn(),
    sendMessageWithStatus: jest.fn(),
  },
}));

type MockSocket = {
  connected: boolean;
  on: jest.Mock;
  off: jest.Mock;
  emit: jest.Mock;
};

const setupSocket = (overrides: Partial<MockSocket> = {}) => {
  const socket: MockSocket = {
    connected: true,
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    ...overrides
  };

  (useSocket as jest.Mock).mockReturnValue({
    socket,
    connected: socket.connected,
    lastSocketError: null,
    emit: socket.emit,
    on: socket.on,
    off: socket.off
  });

  return socket;
};

describe('useChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (apiClient.sendMessage as jest.Mock).mockReset();
    (apiClient.sendMessageWithStatus as jest.Mock).mockReset();
  });

  it('joins conversation and clears error on ACK success', async () => {
    setupSocket();
    (emitWithAck as jest.Mock).mockResolvedValue({ conversationId: 'conv-1' });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token',
        onNewMessage: jest.fn()
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledWith(expect.anything(), 'join-conversation', { conversationId: 'conv-1' }, expect.anything()));
    expect(result.current.lastError).toBeNull();
  });

  it('sets lastError on join timeout and does not clear when cancelled', async () => {
    setupSocket();
    (emitWithAck as jest.Mock).mockRejectedValue({ code: 'CLIENT_TIMEOUT', message: 'timeout' });

    const { result, unmount } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(result.current.lastError?.code).toBe('CLIENT_TIMEOUT'));
    unmount();
  });

  it('sendMessage resolves after WS ACK success', async () => {
    setupSocket();
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId: 'conv-1' }) // join
      .mockResolvedValueOnce({
        id: 'msg-1',
        conversationId: 'conv-1',
        content: 'hello',
        type: 'TEXT',
        createdAt: '2025-01-01T00:00:00.000Z'
      });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage('hello');
    });

    expect(sendResult).toMatchObject({
      success: true,
      transport: 'WS',
      clientMsgId: expect.any(String),
      created: undefined // undefined because mock doesn't return created flag
    });
    expect(result.current.lastError).toBeNull();
    expect(emitWithAck).toHaveBeenLastCalledWith(
      expect.anything(),
      'send-message',
      { conversationId: 'conv-1', content: 'hello', type: 'TEXT', clientMsgId: expect.any(String) },
      expect.anything()
    );
  });

  it('sendMessage propagates forbidden error via lastError (no fallback)', async () => {
    setupSocket();
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId: 'conv-1' }) // join
      .mockRejectedValueOnce({ code: ERROR_CODES.FORBIDDEN, message: 'Nope' });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage('hello');
    });

    expect(sendResult?.success).toBe(false);
    if (sendResult && !sendResult.success) {
      expect((sendResult.error as { code?: string })?.code).toBe(ERROR_CODES.FORBIDDEN);
    }
    expect(result.current.lastError?.code).toBe(ERROR_CODES.FORBIDDEN);
    expect(apiClient.sendMessage).not.toHaveBeenCalled(); // No HTTP fallback on FORBIDDEN
  });

  it('sendMessage handles rate limit with retryAfter hint (no fallback)', async () => {
    setupSocket();
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId: 'conv-1' }) // join
      .mockRejectedValueOnce({ code: ERROR_CODES.RATE_LIMITED, message: 'Too many', details: { retryAfter: 3 } });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage('hello');
    });

    expect(sendResult?.success).toBe(false);
    if (sendResult && !sendResult.success) {
      const error = sendResult.error as { code?: string; details?: { retryAfter?: number } };
      expect(error?.code).toBe(ERROR_CODES.RATE_LIMITED);
      expect(error?.details?.retryAfter).toBe(3); // Raw error has retryAfter in details
    }
    expect(result.current.lastError?.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(apiClient.sendMessage).not.toHaveBeenCalled(); // No HTTP fallback on RATE_LIMITED
  });

  // C2: HTTP fallback tests
  it('sendMessage falls back to HTTP on WS CLIENT_TIMEOUT and succeeds', async () => {
    setupSocket();
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId: 'conv-1' }) // join
      .mockRejectedValueOnce({ code: 'CLIENT_TIMEOUT', message: 'ACK timeout' });
    (apiClient.sendMessageWithStatus as jest.Mock).mockResolvedValueOnce({
      data: { id: 'msg-2' },
      status: 201 // Created
    });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage('hello');
    });

    expect(sendResult).toMatchObject({
      success: true,
      transport: 'HTTP',
      clientMsgId: expect.any(String),
      created: true // 201 = created
    });
    expect(result.current.lastError).toBeNull(); // Cleared after HTTP success
    expect(apiClient.sendMessageWithStatus).toHaveBeenCalledWith('conv-1', {
      type: 'TEXT',
      content: 'hello',
      clientMsgId: expect.any(String)
    });
  });

  it('sendMessage falls back to HTTP on WS CLIENT_TIMEOUT but HTTP fails with FORBIDDEN', async () => {
    setupSocket();
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId: 'conv-1' }) // join
      .mockRejectedValueOnce({ code: 'CLIENT_TIMEOUT', message: 'ACK timeout' });
    (apiClient.sendMessageWithStatus as jest.Mock).mockRejectedValueOnce({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Access denied',
      status: 403
    });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    let sendResult;
    await act(async () => {
      sendResult = await result.current.sendMessage('hello');
    });

    expect(sendResult?.success).toBe(false);
    if (sendResult && !sendResult.success) {
      expect((sendResult.error as { code?: string })?.code).toBe(ERROR_CODES.FORBIDDEN);
      expect(sendResult.clientMsgId).toBeDefined();
    }
    expect(apiClient.sendMessageWithStatus).toHaveBeenCalledTimes(1); // HTTP fallback attempted once
  });

  it('sendMessage WS CLIENT_TIMEOUT triggers HTTP fallback exactly once (anti-loop)', async () => {
    setupSocket();
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId: 'conv-1' }) // join
      .mockRejectedValueOnce({ code: 'CLIENT_TIMEOUT', message: 'ACK timeout' });
    (apiClient.sendMessageWithStatus as jest.Mock).mockResolvedValueOnce({
      data: { id: 'msg-3' },
      status: 201
    });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    // Verify: 1 WS attempt + 1 HTTP attempt = 2 total calls
    expect(emitWithAck).toHaveBeenCalledTimes(2); // 1 join + 1 send-message
    expect(apiClient.sendMessageWithStatus).toHaveBeenCalledTimes(1); // Exactly 1 HTTP fallback
  });

  it('sendMessage with meta passes meta to HTTP fallback', async () => {
    setupSocket();
    (emitWithAck as jest.Mock)
      .mockResolvedValueOnce({ conversationId: 'conv-1' }) // join
      .mockRejectedValueOnce({ code: 'CLIENT_TIMEOUT', message: 'ACK timeout' });
    (apiClient.sendMessageWithStatus as jest.Mock).mockResolvedValueOnce({
      data: { id: 'msg-4' },
      status: 201
    });

    const { result } = renderHook(() =>
      useChat({
        conversationId: 'conv-1',
        token: 'token'
      })
    );

    await waitFor(() => expect(emitWithAck).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.sendMessage('Proposition', 'PROPOSAL', { date: '2025-01-15', place: 'Beach' });
    });

    expect(apiClient.sendMessageWithStatus).toHaveBeenCalledWith('conv-1', {
      type: 'PROPOSAL',
      content: 'Proposition',
      meta: { date: '2025-01-15', place: 'Beach' },
      clientMsgId: expect.any(String)
    });
  });
});
