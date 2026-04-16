import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useRouter } from 'next/navigation';
import { AuthForm } from '../AuthForm';
import { apiClient } from '../../lib/apiClient';
import { useToast } from '../ui/toast';
import { useAnalytics } from '@/hooks/useAnalytics';
import { FRANCE_ONLY_COPY } from '../../lib/france-only';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

jest.mock('../../lib/apiClient', () => ({
  apiClient: {
    register: jest.fn(),
    login: jest.fn(),
    me: jest.fn(),
    saveTokens: jest.fn(),
    resendVerification: jest.fn(),
    verify2FA: jest.fn(),
  },
}));

jest.mock('../ui/toast', () => ({
  useToast: jest.fn(),
}));

jest.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: jest.fn(),
}));

const mockedUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedUseToast = useToast as jest.Mock;
const mockedUseAnalytics = useAnalytics as jest.Mock;

describe('AuthForm', () => {
  const mockPush = jest.fn();
  const mockToast = jest.fn();
  const mockTrackEvent = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue({
      push: mockPush,
      replace: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    mockedUseToast.mockReturnValue(mockToast);
    mockedUseAnalytics.mockReturnValue({ trackEvent: mockTrackEvent });
    mockedApiClient.register.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('shows the France-only info toast for PRO registration and sends FR to the API', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<AuthForm mode="register" />);

    await user.type(screen.getByLabelText(/email/i), 'pro-fr@test.com');
    await user.type(screen.getByLabelText(/^mot de passe$/i, { selector: 'input' }), 'Passw0rd!Strong');
    await user.selectOptions(screen.getByLabelText(/rôle/i), 'PRO');

    expect(mockToast).toHaveBeenCalledWith(FRANCE_ONLY_COPY.proInfo, 'info', 4000);

    await user.click(screen.getByRole('checkbox', { name: /18 ans ou plus/i }));
    await user.click(screen.getByRole('checkbox', { name: /j'ai lu et j'accepte la charte de sécurité et l'avertissement/i }));
    await user.click(screen.getByRole('button', { name: /créer le compte/i }));

    await waitFor(() => {
      expect(mockedApiClient.register).toHaveBeenCalledWith({
        email: 'pro-fr@test.com',
        password: 'Passw0rd!Strong',
        role: 'PRO',
        ageConfirmed: true,
        consentAccepted: true,
        proCountryCode: 'FR',
      });
    });
  });
});
