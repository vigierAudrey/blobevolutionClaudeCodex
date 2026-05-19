import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/navigation';
import ProLoginPage from '../page';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    send2FA: jest.fn(),
    verifyPro2FA: jest.fn(),
    me: jest.fn(),
    saveTokens: jest.fn(),
  },
}));

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('ProLoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
  });

  it('active le session hint après verifyPro2FA puis redirige le PRO vers /pro/onboarding', async () => {
    mockedApiClient.send2FA.mockResolvedValueOnce({ message: 'Code envoyé' } as never);
    mockedApiClient.verifyPro2FA.mockResolvedValueOnce({ ok: true, message: 'Authentification 2FA réussie' } as never);
    mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO' } as never);

    render(<ProLoginPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email professionnel/i), 'pro@test.com');
    await user.click(screen.getByRole('button', { name: /envoyer le code de sécurité/i }));
    await user.type(screen.getByLabelText(/code de sécurité/i), '123456');
    await user.click(screen.getByRole('button', { name: /se connecter/i }));

    expect(mockedApiClient.verifyPro2FA).toHaveBeenCalledWith('pro@test.com', '123456');
    expect(mockedApiClient.saveTokens).toHaveBeenCalledTimes(1);
    expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
    expect(mockUseRouter.mock.results[0]?.value.push).toHaveBeenCalledWith('/pro/onboarding');
  });
});
