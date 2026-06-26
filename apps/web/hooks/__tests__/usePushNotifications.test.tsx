/**
 * Tests for usePushNotifications.
 *
 * Invariants asserted:
 *  - no permission prompt on mount.
 *  - unsupported browser yields a neutral, non-error state.
 *  - permission 'denied' yields a neutral, non-subscribable state.
 *  - subscribe/unsubscribe delegate to the manager (which never sends a userId).
 */

import { renderHook, act, waitFor } from '@testing-library/react';

jest.mock('../../lib/pushNotifications', () => ({
  pushManager: {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    checkServerStatus: jest.fn(),
    getPermissionStatus: jest.fn(),
    hasLocalToken: jest.fn(),
  },
}));

import { usePushNotifications } from '../usePushNotifications';
import { pushManager } from '../../lib/pushNotifications';

const mockPushManager = pushManager as unknown as {
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  checkServerStatus: jest.Mock;
  getPermissionStatus: jest.Mock;
  hasLocalToken: jest.Mock;
};

const mockRequestPermission = jest.fn();

function setupEnv(opts: { supported: boolean; permission: NotificationPermission }) {
  Object.defineProperty(global, 'Notification', {
    configurable: true,
    writable: true,
    value: { permission: opts.permission, requestPermission: mockRequestPermission },
  });
  if (opts.supported) {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: jest.fn().mockResolvedValue(undefined) },
    });
  } else {
    // Remove serviceWorker entirely so `'serviceWorker' in navigator` is false.
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  }
  mockPushManager.getPermissionStatus.mockReturnValue(opts.permission);
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPushManager.checkServerStatus.mockResolvedValue(null);
    mockPushManager.hasLocalToken.mockReturnValue(false);
  });

  it('does not prompt for permission on mount', async () => {
    setupEnv({ supported: true, permission: 'default' });

    renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(mockPushManager.getPermissionStatus).toHaveBeenCalled();
    });
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('reports a neutral unsupported state', () => {
    setupEnv({ supported: false, permission: 'default' });

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.canSubscribe).toBe(false);
    // No server status call when unsupported.
    expect(mockPushManager.checkServerStatus).not.toHaveBeenCalled();
  });

  it('reports a neutral denied state (not subscribable)', () => {
    setupEnv({ supported: true, permission: 'denied' });

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.permission).toBe('denied');
    expect(result.current.canSubscribe).toBe(false);
  });

  it('reflects ACCOUNT status on mount without claiming this browser is active', async () => {
    setupEnv({ supported: true, permission: 'granted' });
    mockPushManager.checkServerStatus.mockResolvedValue(true);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.accountHasPush).toBe(true);
    });
    // Account-level true must NOT be presented as this-browser subscribed.
    expect(result.current.thisBrowserActive).toBe(false);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('subscribe delegates to the manager and marks THIS browser active', async () => {
    setupEnv({ supported: true, permission: 'default' });
    mockPushManager.checkServerStatus.mockResolvedValue(false);
    mockPushManager.subscribe.mockResolvedValue(true);
    mockPushManager.getPermissionStatus.mockReturnValue('granted');

    const { result } = renderHook(() => usePushNotifications());

    let ok = false;
    await act(async () => {
      ok = await result.current.subscribe();
    });

    expect(ok).toBe(true);
    expect(mockPushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.thisBrowserActive).toBe(true);
  });

  it('unsubscribe delegates to the manager and clears this-browser state', async () => {
    setupEnv({ supported: true, permission: 'granted' });
    mockPushManager.checkServerStatus.mockResolvedValue(false);
    mockPushManager.subscribe.mockResolvedValue(true);
    mockPushManager.unsubscribe.mockResolvedValue(true);

    const { result } = renderHook(() => usePushNotifications());

    // Become active via a real subscribe (local proof), then unsubscribe.
    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.thisBrowserActive).toBe(true);

    let ok = false;
    await act(async () => {
      ok = await result.current.unsubscribe();
    });

    expect(ok).toBe(true);
    expect(mockPushManager.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.thisBrowserActive).toBe(false);
  });

  it('does not subscribe when backend push status is unavailable', async () => {
    setupEnv({ supported: true, permission: 'default' });
    mockPushManager.checkServerStatus.mockResolvedValue(null);
    mockPushManager.subscribe.mockResolvedValue(true);

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => {
      expect(result.current.backendAvailable).toBe(false);
    });

    let ok = true;
    await act(async () => {
      ok = await result.current.subscribe();
    });

    expect(ok).toBe(false);
    expect(result.current.canSubscribe).toBe(false);
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });
});
