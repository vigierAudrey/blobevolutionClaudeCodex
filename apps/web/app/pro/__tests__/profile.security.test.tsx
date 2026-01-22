import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProProfilePage from '../profile/page';

// Sécurité P2 : garde-fous contre la régression des patchs d'audit.
const resetConsentMock = jest.fn();
const toastMock = jest.fn();
const apiRequestMock = jest.fn();
const getTokensMock = jest.fn(() => ({ accessToken: 'token' }));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../../lib/apiClient', () => ({
  apiClient: { getTokens: () => getTokensMock() },
}));

jest.mock('../../../lib/csrf', () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

jest.mock('../../../components/cookies/CookieConsent', () => ({
  COOKIE_CONSENT_REOPEN_EVENT: 'cookie-consent-reopen',
  useCookieConsent: () => ({
    updateConsent: resetConsentMock,
    consentReady: true,
    consentLevel: 'personalized',
  }),
}));

jest.mock('../../../components/profile/ChangePasswordCard', () => ({
  ChangePasswordCard: () => <div data-testid="change-password" />,
}));

jest.mock('../../../components/ui/toast', () => ({
  useToast: () => toastMock,
}));

describe('ProProfilePage security patches', () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation((url: unknown) => {
      if (url === '/pro/me') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ lat: 9999, lng: 9999 }),
        });
      }
      if (url === '/profile/notifications') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ preferences: {} }),
        });
      }
      if (url === '/pro/deletion-status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    resetConsentMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    apiRequestMock.mockClear();
    resetConsentMock.mockClear();
    toastMock.mockClear();
  });

  it('sanitizes invalid coordinates to N/A', async () => {
    render(<ProProfilePage />);

    expect(await screen.findByText(/Lat: N\/A, Lng: N\/A/)).toBeInTheDocument();
  });

  it('throttles rapid cookie consent reopen', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    let now = 5000;
    nowSpy.mockImplementation(() => now);

    render(<ProProfilePage />);

    const button = await screen.findByRole('button', { name: /Gérer mes cookies/i });
    fireEvent.click(button);

    await waitFor(() => expect(resetConsentMock).toHaveBeenCalledTimes(1));

    now += 500;
    fireEvent.click(button);

    expect(resetConsentMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      'Merci de patienter quelques secondes avant de réessayer.',
      'info'
    );

    nowSpy.mockRestore();
  });
});
