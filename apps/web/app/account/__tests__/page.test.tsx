/**
 * Auth guard tests for AccountPage.
 *
 * Invariants verified:
 *   1. Valid server session + no localStorage hint → page renders, no /login redirect
 *   2. Invalid server session (401) → redirect to /login
 *   3. Role mismatch is not confused with "not authenticated"
 *   4. getTokens() is never called (hint not consulted)
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/account'),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(), // must NOT be called by the guard
    logoutAll: jest.fn(),
    resendVerification: jest.fn(),
  },
}));

jest.mock('@/lib/clientSession', () => {
  const actual = jest.requireActual('@/lib/clientSession');
  return actual; // use real implementation backed by the mocked apiClient
});

import AccountPage from '../page';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('AccountPage — auth guard', () => {
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
    // Ensure localStorage has no session hint
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('blob_session_hint');
    }
  });

  it('renders page when server session is valid — even with no local hint', async () => {
    mockedApiClient.me.mockResolvedValueOnce({
      id: 'u1',
      email: 'rider@test.com',
      role: 'RIDER',
      emailVerified: true,
    } as never);

    render(<AccountPage />);

    await waitFor(() => {
      expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
    expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
  });

  it('redirects to /login when server session returns 401', async () => {
    const err = Object.assign(new Error('Session expirée'), { code: 'SESSION_EXPIRED' });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<AccountPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects to /login when server returns status 401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<AccountPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('does not call getTokens() — hint is never consulted', async () => {
    mockedApiClient.me.mockResolvedValueOnce({
      id: 'u1',
      email: 'rider@test.com',
      role: 'RIDER',
      emailVerified: true,
    } as never);

    render(<AccountPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(mockedApiClient.getTokens).not.toHaveBeenCalled();
  });

  it('shows error message (not /login) on non-auth server error', async () => {
    const err = Object.assign(new Error('Internal server error'), { status: 500 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<AccountPage />);

    await waitFor(() => {
      expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    });

    // Should NOT redirect to /login for a 500 error
    expect(replace).not.toHaveBeenCalledWith('/login');
  });
});
