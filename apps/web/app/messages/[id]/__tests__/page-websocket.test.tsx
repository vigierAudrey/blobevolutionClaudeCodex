/**
 * Auth guard tests for ConversationPage (websocket variant).
 *
 * Invariants verified:
 *   1. Valid session → no /login redirect; sessionReady=true opens websocket gate
 *   2. SESSION_EXPIRED from me() → redirect to /login
 *   3. status=401 from me() → redirect to /login
 *   4. Non-auth error (503) → no /login redirect
 *   5. getTokens() is never called (localStorage never consulted for auth)
 *   6. useChat receives a non-empty token after successful me() (gate opens)
 *   7. useChat receives empty token string before/on me() failure (gate stays closed)
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useRouter, useParams } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(() => ({ id: 'conv-456' })),
  usePathname: jest.fn(() => '/messages/conv-456'),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(), // must NOT be called
    getMessages: jest.fn(),
    findConversationById: jest.fn(),
    sendMessage: jest.fn(),
    blockConversation: jest.fn(),
    unblockConversation: jest.fn(),
  },
}));

// Capture the token argument passed to useChat so tests can assert on it
const useChatMock = jest.fn();
jest.mock('@/hooks/useChat', () => ({
  useChat: (opts: { token: string }) => {
    useChatMock(opts.token);
    return {
      connected: false,
      sendMessage: jest.fn(),
      setTyping: jest.fn(),
      otherUserTyping: false,
      lastError: null,
    };
  },
}));

jest.mock('@/lib/getUserFacingMessage', () => ({
  getUserFacingMessage: (_err: unknown, fallback: string) => fallback,
}));

jest.mock('@/lib/normalizeAppError', () => ({
  normalizeAppError: (err: unknown) => ({ code: 'UNKNOWN', source: 'test', debug: err }),
}));

import ConversationPageWS from '../page-websocket';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const validThread = {
  id: 'conv-456',
  participants: [],
  lastMessage: null,
  unreadCount: 0,
};

describe('ConversationPage (websocket) — auth guard', () => {
  const replace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useChatMock.mockClear();
    replace.mockReset();
    // jsdom doesn't implement scrollIntoView — stub it to avoid unhandled errors
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    mockUseRouter.mockReturnValue({
      replace,
      push: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('blob_session_hint');
    }
    mockedApiClient.getMessages.mockResolvedValue({ items: [] } as never);
    mockedApiClient.findConversationById.mockResolvedValue(validThread as never);
  });

  it('mounts without /login redirect when session is valid', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ id: 'u1', role: 'RIDER' } as never);

    render(<ConversationPageWS />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('opens websocket gate (non-empty token) after successful me()', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ id: 'u1', role: 'RIDER' } as never);

    render(<ConversationPageWS />);

    await waitFor(() => {
      // After me() resolves, sessionReady=true → useChat token becomes '1'
      const calls = useChatMock.mock.calls.map((c) => c[0]);
      expect(calls).toContain('1');
    });
  });

  it('redirects to /login when me() returns SESSION_EXPIRED', async () => {
    const err = Object.assign(new Error('Session expirée'), { code: 'SESSION_EXPIRED' });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<ConversationPageWS />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects to /login when me() returns status=401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<ConversationPageWS />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('does NOT redirect to /login on non-auth error from me()', async () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<ConversationPageWS />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('does not call getTokens() — hint is never consulted', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ id: 'u1', role: 'RIDER' } as never);

    render(<ConversationPageWS />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(mockedApiClient.getTokens).not.toHaveBeenCalled();
  });

  it('websocket gate stays closed (empty token) when me() fails', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<ConversationPageWS />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });

    // sessionReady was never set to true → token was always '' for useChat
    const calls = useChatMock.mock.calls.map((c) => c[0]);
    expect(calls.every((t: string) => t === '')).toBe(true);
  });
});
