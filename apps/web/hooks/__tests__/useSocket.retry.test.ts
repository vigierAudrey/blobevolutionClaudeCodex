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
  let mockSocket: any;
  let connectErrorHandler: ((error: Error) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock socket instance
    mockSocket = {
      connected: false,
      on: jest.fn((event: string, handler: any) => {
        if (event === 'connect_error') {
          connectErrorHandler = handler;
        }
      }),
      off: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      auth: {}
    };

    (socketLib.getSocket as jest.Mock).mockReturnValue(mockSocket);
    (socketLib.reconnectSocketWithNewToken as jest.Mock).mockImplementation(() => {});
  });

  it('should only attempt token refresh once on repeated auth errors', async () => {
    const mockRefreshToken = jest.fn()
      .mockResolvedValueOnce(true) // First call succeeds
      .mockResolvedValueOnce(true); // Second call (should NOT happen)

    const mockGetTokens = jest.fn().mockReturnValue({
      accessToken: 'new-token-123',
      refreshToken: 'refresh-token-456'
    });

    (apiClient.refreshToken as jest.Mock) = mockRefreshToken;
    (apiClient.getTokens as jest.Mock) = mockGetTokens;

    // Render hook with autoConnect
    renderHook(() => useSocket({
      token: 'old-token',
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
    expect(socketLib.reconnectSocketWithNewToken).toHaveBeenCalledTimes(1);
  });

  it('should reset retry flag on successful connection', async () => {
    const mockRefreshToken = jest.fn().mockResolvedValue(true);
    const mockGetTokens = jest.fn().mockReturnValue({
      accessToken: 'new-token',
      refreshToken: 'refresh-token'
    });

    (apiClient.refreshToken as jest.Mock) = mockRefreshToken;
    (apiClient.getTokens as jest.Mock) = mockGetTokens;

    let connectHandler: (() => void) | null = null;

    mockSocket.on = jest.fn((event: string, handler: any) => {
      if (event === 'connect_error') {
        connectErrorHandler = handler;
      } else if (event === 'connect') {
        connectHandler = handler;
      }
    });

    // Render hook
    renderHook(() => useSocket({
      token: 'token',
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
    if (connectHandler) {
      connectHandler();
    }

    // Wait for state update
    await new Promise(resolve => setTimeout(resolve, 50));

    // Second auth error after successful connect → should trigger refresh AGAIN
    if (connectErrorHandler) {
      await connectErrorHandler(new Error('401 Unauthorized'));
    }

    await waitFor(() => {
      expect(mockRefreshToken).toHaveBeenCalledTimes(2);
    }, { timeout: 1000 });
  });

  it('should not trigger concurrent refresh if errors arrive rapidly', async () => {
    // Mock slow refresh (200ms)
    const mockRefreshToken = jest.fn(() =>
      new Promise(resolve => setTimeout(() => resolve(true), 200))
    );

    const mockGetTokens = jest.fn().mockReturnValue({
      accessToken: 'new-token',
      refreshToken: 'refresh-token'
    });

    (apiClient.refreshToken as jest.Mock) = mockRefreshToken;
    (apiClient.getTokens as jest.Mock) = mockGetTokens;

    // Render hook
    renderHook(() => useSocket({
      token: 'token',
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
    // Guard: reconnectSocketWithNewToken should be called only ONCE (not twice)
    // Second handler awaits same Promise and uses lastReconnectedTokenRef guard
    expect(socketLib.reconnectSocketWithNewToken).toHaveBeenCalledTimes(1);
  });
});
