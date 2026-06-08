/**
 * Auth guard tests for OnboardingPage.
 *
 * Invariants verified:
 *   1. Valid server session + no localStorage hint → page renders, no /login redirect
 *   2. Invalid server session (SESSION_EXPIRED) → redirect to /login
 *   3. PRO role → redirect to /pro/onboarding, not /login
 *   4. getTokens() is never called (hint not consulted)
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/onboarding'),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(), // must NOT be called
    getProfile: jest.fn(),
    getDisciplines: jest.fn(),
  },
}));

jest.mock('@/lib/clientSession', () => jest.requireActual('@/lib/clientSession'));

import OnboardingPage from '../page';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('OnboardingPage — auth guard', () => {
  const replace = jest.fn();
  const push = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    replace.mockReset();
    push.mockReset();
    mockUseRouter.mockReturnValue({
      replace,
      push,
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('blob_session_hint');
      window.localStorage.removeItem('blob_onboarding_complete');
    }
    // Default profile setup: incomplete (triggers onboarding display)
    mockedApiClient.getProfile.mockResolvedValue({
      displayName: null,
      hasPhoto: false,
      photoEndpoint: null,
    } as never);
    mockedApiClient.getDisciplines.mockResolvedValue([]);
  });

  it('renders onboarding when session is valid — even with no local hint', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
    expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
  });

  it('redirects to /login on SESSION_EXPIRED — not before checking the server', async () => {
    const err = Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
    // Profile should not have been fetched — session gate fires first
    expect(mockedApiClient.getProfile).not.toHaveBeenCalled();
  });

  it('redirects PRO to /pro/onboarding — not /login', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/pro/onboarding');
    });
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('does not call getTokens() — hint is never consulted', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(mockedApiClient.getTokens).not.toHaveBeenCalled();
  });
});
