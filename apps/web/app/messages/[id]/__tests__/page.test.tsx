/**
 * Auth guard tests for ConversationPage (polling variant).
 *
 * Invariants verified:
 *   1. Valid server session → page mounts, no /login redirect
 *   2. SESSION_EXPIRED from me() → redirect to /login
 *   3. status=401 from me() → redirect to /login
 *   4. Non-auth error from me() → no /login redirect (early return, content skipped)
 *   5. getTokens() is never called (hint not consulted)
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(() => ({ id: 'conv-123' })),
  usePathname: jest.fn(() => '/messages/conv-123'),
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

jest.mock('@/components/ConversationMembers', () => ({
  ConversationMembers: () => null,
}));

import ConversationPage from '../page';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const validThread = {
  id: 'conv-123',
  participants: [],
  lastMessage: null,
  unreadCount: 0,
};

describe('ConversationPage (polling) — auth guard', () => {
  const replace = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    replace.mockReset();
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
    // Happy-path defaults so auth-pass tests can render fully
    mockedApiClient.getMessages.mockResolvedValue({ items: [] } as never);
    mockedApiClient.findConversationById.mockResolvedValue(validThread as never);
  });

  it('mounts without /login redirect when session is valid', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ id: 'u1', role: 'RIDER' } as never);

    render(<ConversationPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when me() returns SESSION_EXPIRED', async () => {
    const err = Object.assign(new Error('Session expirée'), { code: 'SESSION_EXPIRED' });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<ConversationPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects to /login when me() returns status=401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<ConversationPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('does NOT redirect to /login on non-auth error from me()', async () => {
    const err = Object.assign(new Error('Network error'), { status: 503 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<ConversationPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('does not call getTokens() — hint is never consulted', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ id: 'u1', role: 'RIDER' } as never);

    render(<ConversationPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(mockedApiClient.getTokens).not.toHaveBeenCalled();
  });
});
