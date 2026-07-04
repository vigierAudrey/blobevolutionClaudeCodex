import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
  usePathname: jest.fn(() => '/matching/date'),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    updateProfile: jest.fn(),
  },
}));

import DatePage from '../page';

const mockUseRouter = jest.mocked(useRouter);
const mockUseSearchParams = jest.mocked(useSearchParams);
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('Matching date step', () => {
  const replace = jest.fn();
  const push = jest.fn();
  const getCurrentPosition = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockUseRouter.mockReturnValue({
      replace,
      push,
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams({ sport: 'surf', level: 'intermediate' }) as ReturnType<typeof useSearchParams>,
    );
    mockedApiClient.me.mockResolvedValue({ role: 'RIDER' } as never);
    mockedApiClient.updateProfile.mockResolvedValue({} as never);
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
  });

  it('renders the active date step with its required controls', async () => {
    render(<DatePage />);

    expect(await screen.findByRole('heading', { name: 'Date et options' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aujourd'hui/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voir les profils' })).toBeDisabled();
    expect(replace).not.toHaveBeenCalledWith('/matching');
  });

  it('preserves the PRO redirect', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO' } as never);

    render(<DatePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/pro/dashboard'));
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('preserves the login redirect when the server session fails', async () => {
    mockedApiClient.me.mockRejectedValueOnce(new Error('session interne sensible'));

    render(<DatePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText(/session interne sensible/i)).not.toBeInTheDocument();
  });

  it('persists the position to the profile on geolocation success (discoverability)', async () => {
    const user = userEvent.setup();
    getCurrentPosition.mockImplementationOnce(
      (success: PositionCallback) =>
        success({ coords: { latitude: 44.98, longitude: -1.195 } } as GeolocationPosition),
    );

    render(<DatePage />);
    await user.click(await screen.findByRole('button', { name: 'Activer ma position' }));

    await waitFor(() =>
      expect(mockedApiClient.updateProfile).toHaveBeenCalledWith({ lat: 44.98, lng: -1.195 }),
    );
    expect(screen.getByText(/Position : 44\.9800, -1\.1950/)).toBeInTheDocument();
  });

  it('shows a neutral geolocation state without logging the browser error', async () => {
    const user = userEvent.setup();
    const browserError = { code: 1, message: 'coordonnées et diagnostic sensibles' };
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    getCurrentPosition.mockImplementationOnce(
      (_success: PositionCallback, failure: PositionErrorCallback) => failure(browserError as GeolocationPositionError),
    );

    render(<DatePage />);
    await user.click(await screen.findByRole('button', { name: 'Activer ma position' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vérifie les autorisations de ton navigateur.');
    expect(screen.queryByText(/diagnostic sensibles/i)).not.toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('diagnostic sensibles');
    consoleError.mockRestore();
  });
});
