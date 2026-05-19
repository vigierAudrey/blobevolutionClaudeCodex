/**
 * Tests unitaires pour useSocket retry logic
 * ✅ E-REVIEW P0 #2: Test que refresh n'est tenté qu'une seule fois
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useSocket } from '../useSocket';
import { apiClient } from '../../lib/apiClient';
import * as socketLib from '../../lib/socket';

// Mock dependencies
jest.mock('../../lib/apiClient');
jest.mock('../../lib/socket');
jest.mock('../../lib/socketUtils', () => ({
  isAuthConnectError: jest.fn(() => true)
}));

describe('useSocket retry logic', () => {
  type SocketEventHandler = (...args: unknown[]) => void | Promise<void>;
  type MockSocket = {
    connected: boolean;
    on: jest.Mock<void, [string, SocketEventHandler]>;
    off: jest.Mock<void, [string, SocketEventHandler?]>;
    connect: jest.Mock<void, []>;
    disconnect: jest.Mock<void, []>;
    emit: jest.Mock<void, [string, unknown]>;
    auth: Record<string, unknown>;
  };

  const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;
  const mockGetSocket = jest.mocked(socketLib.getSocket);
  const mockReconnectSocket = jest.mocked(socketLib.reconnectSocket);
  const invokeConnectHandler = (handler: (() => void) | null) => {
    if (handler !== null) {
      handler();
    }
  };

  let mockSocket: MockSocket;
  let connectErrorHandler: ((error: Error) => Promise<void>) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    // Mock socket instance
    mockSocket = {
      connected: false,
      on: jest.fn((event: string, handler: SocketEventHandler) => {
        if (event === 'connect_error') {
          connectErrorHandler = async (error: Error) => {
            await handler(error);
          };
        }
      }),
      off: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      auth: {}
    };

    mockGetSocket.mockReturnValue(mockSocket as never);
    mockReconnectSocket.mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should only attempt token refresh once on repeated auth errors', async () => {
    const mockRefreshToken = jest.fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true) // First call succeeds
      .mockResolvedValueOnce(true); // Second call (should NOT happen)

    mockApiClient.refreshToken = mockRefreshToken;

    // Render hook with autoConnect
    renderHook(() => useSocket({
      token: 'session-hint',
      autoConnect: true
    }));

    // Wait for socket setup
    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });

    // Simulate first auth error
    if (connectErrorHandler) {
      await connectErrorHandler(new Error('401 Unauthorized'));
    }

    // Wait for refresh attempt
    await waitFor(() => {
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    });

    // Simulate second auth error (should NOT trigger refresh again)
    if (connectErrorHandler) {
      await connectErrorHandler(new Error('401 Unauthorized'));
    }

    // Wait a bit to ensure no second refresh
    await new Promise(resolve => setTimeout(resolve, 100));

    // Assert: refreshToken should still be called only once
    expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockReconnectSocket).toHaveBeenCalledTimes(1);
    expect(mockApiClient.getTokens).not.toHaveBeenCalled();
  });

  it('should reset retry flag on successful connection', async () => {
    const mockRefreshToken = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);

    mockApiClient.refreshToken = mockRefreshToken;

    let connectHandler: (() => void) | null = null;

    mockSocket.on = jest.fn((event: string, handler: SocketEventHandler) => {
      if (event === 'connect_error') {
        connectErrorHandler = async (error: Error) => {
          await handler(error);
        };
      } else if (event === 'connect') {
        connectHandler = () => {
          void handler();
        };
      }
    });

    // Render hook
    renderHook(() => useSocket({
      token: 'session-hint',
      autoConnect: true
    }));

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalled();
    });

    // First auth error → should trigger refresh
    if (connectErrorHandler) {
      await connectErrorHandler(new Error('401 Unauthorized'));
    }

    await waitFor(() => {
      expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    });

    // Simulate successful connection (resets flag)
    invokeConnectHandler(connectHandler);

    // Wait for state update
    await new Promise(resolve => setTimeout(resolve, 50));

    // Second auth error after successful connect → should trigger refresh AGAIN
    if (connectErrorHandler) {
      await connectErrorHandler(new Error('401 Unauthorized'));
    }

    await waitFor(() => {
      expect(mockRefreshToken).toHaveBeenCalledTimes(2);
    }, { timeout: 1000 });
    expect(mockReconnectSocket).toHaveBeenCalledTimes(2);
    expect(mockApiClient.getTokens).not.toHaveBeenCalled();
  });

  it('should not trigger concurrent refresh if errors arrive rapidly', async () => {
    // Mock slow refresh (200ms)
    const mockRefreshToken = jest.fn<Promise<boolean>, []>(() =>
      new Promise(resolve => setTimeout(() => resolve(true), 200))
    );

    mockApiClient.refreshToken = mockRefreshToken;

    // Render hook
    renderHook(() => useSocket({
      token: 'session-hint',
      autoConnect: true
    }));

    await waitFor(() => {
      expect(mockSocket.on).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });

    // Trigger 2 auth errors rapidly (before first refresh completes)
    if (connectErrorHandler) {
      const promise1 = connectErrorHandler(new Error('401 Unauthorized'));
      const promise2 = connectErrorHandler(new Error('401 Unauthorized'));

      // Wait for both to complete
      await Promise.all([promise1, promise2]);
    }

    // Wait extra time to ensure no additional calls
    await new Promise(resolve => setTimeout(resolve, 300));

    // Assert: refreshToken should be called only once (concurrent guard works)
    expect(mockRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockReconnectSocket).toHaveBeenCalledTimes(2);
    expect(mockApiClient.getTokens).not.toHaveBeenCalled();
  });
});
