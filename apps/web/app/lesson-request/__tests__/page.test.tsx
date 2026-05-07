/**
 * Auth guard tests for LessonRequestPage.
 *
 * Invariants verified:
 *   1. Valid server session → page renders, no /login redirect
 *   2. SESSION_EXPIRED error from getProfile() → redirect to /login
 *   3. status=401 error from getProfile() → redirect to /login
 *   4. Non-auth error (500) → no /login redirect (error is logged, not escalated)
 *   5. getTokens() is never called (hint not consulted)
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/lesson-request'),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(), // must NOT be called
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  },
}));

jest.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

import LessonRequestPage from '../page';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('LessonRequestPage — auth guard', () => {
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
  });

  it('renders when server session is valid — no /login redirect', async () => {
    mockedApiClient.getProfile.mockResolvedValueOnce({
      wantsLesson: false,
    } as never);

    render(<LessonRequestPage />);

    await waitFor(() => {
      expect(mockedApiClient.getProfile).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when getProfile() returns SESSION_EXPIRED', async () => {
    const err = Object.assign(new Error('Session expirée'), { code: 'SESSION_EXPIRED' });
    mockedApiClient.getProfile.mockRejectedValueOnce(err);

    render(<LessonRequestPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirects to /login when getProfile() returns status=401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockedApiClient.getProfile.mockRejectedValueOnce(err);

    render(<LessonRequestPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('does NOT redirect to /login on non-auth error (e.g. 500)', async () => {
    const err = Object.assign(new Error('Internal Server Error'), { status: 500 });
    mockedApiClient.getProfile.mockRejectedValueOnce(err);

    render(<LessonRequestPage />);

    await waitFor(() => {
      expect(mockedApiClient.getProfile).toHaveBeenCalled();
    });

    // Loading finishes, but no /login redirect for non-auth errors
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('does not call getTokens() — hint is never consulted', async () => {
    mockedApiClient.getProfile.mockResolvedValueOnce({ wantsLesson: false } as never);

    render(<LessonRequestPage />);

    await waitFor(() => {
      expect(mockedApiClient.getProfile).toHaveBeenCalled();
    });

    expect(mockedApiClient.getTokens).not.toHaveBeenCalled();
  });
});
