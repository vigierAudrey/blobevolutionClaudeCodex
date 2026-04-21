/**
 * Auth guard tests for MatchingPage (sport/level selection).
 *
 * Invariants verified:
 *   1. Valid server session + no localStorage hint → page renders, no /login redirect
 *   2. Invalid server session (401/SESSION_EXPIRED) → redirect to /login
 *   3. PRO role → redirect to /pro/dashboard, not /login
 *   4. Incomplete profile → redirect to /onboarding, not /login
 *   5. getTokens() is never called (hint not consulted)
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/matching'),
  useSearchParams: jest.fn(() => ({ get: jest.fn(() => null) })),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(), // must NOT be called
    getProfile: jest.fn(),
    getDisciplines: jest.fn(),
  },
}));

// Mock the AdBannerFeed dynamic import
jest.mock('@/components/ads/AdBanner', () => ({
  AdBannerFeed: () => null,
}));

import MatchingPage from '../page';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const completeProfile = { displayName: 'Alice', photoUrl: 'https://cdn/photo.jpg' };
const completeDisciplines = [{ sport: 'surf', level: 'intermediate' }];

describe('MatchingPage — auth guard', () => {
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
    }
    // Default: complete profile so the main auth guard behavior is testable
    mockedApiClient.getProfile.mockResolvedValue(completeProfile as never);
    mockedApiClient.getDisciplines.mockResolvedValue(completeDisciplines as never);
  });

  it('renders matching when session is valid — even with no local hint', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<MatchingPage />);

    // Wait for the async useEffect to complete
    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when session returns 401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<MatchingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects to /login when session is SESSION_EXPIRED', async () => {
    const err = Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<MatchingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects PRO to /pro/dashboard — not /login', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO' } as never);

    render(<MatchingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/pro/dashboard');
    });
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('redirects to /onboarding (not /login) when profile is incomplete', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);
    mockedApiClient.getProfile.mockResolvedValue({ displayName: null, photoUrl: null } as never);
    mockedApiClient.getDisciplines.mockResolvedValue([] as never);

    render(<MatchingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/onboarding');
    });
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('does not call getTokens() — hint is never consulted', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<MatchingPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(mockedApiClient.getTokens).not.toHaveBeenCalled();
  });
});
