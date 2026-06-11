import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResetPasswordPage from '../page';
import { apiClient } from '@/lib/apiClient';
import { useRouter, useSearchParams } from 'next/navigation';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
  },
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockUseRouter = useRouter as jest.Mock;
const mockUseSearchParams = useSearchParams as jest.Mock;

describe('ResetPasswordPage', () => {
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
    mockUseSearchParams.mockReturnValue(new URLSearchParams('token=abc123'));
  });

  it('met à jour le mot de passe et affiche un message de succès', async () => {
    mockedApiClient.resetPassword.mockResolvedValueOnce({});

    render(<ResetPasswordPage />);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: /nouveau mot de passe/i })).toBeInTheDocument();
    const passwordInput = await screen.findByLabelText(/nouveau mot de passe/i);
    await waitFor(() => expect(screen.getByLabelText(/token/i)).toHaveValue('abc123'));
    await user.type(passwordInput, 'NewPass123!');
    await user.click(screen.getByRole('button', { name: /mettre à jour/i }));

    expect(mockedApiClient.resetPassword).toHaveBeenCalledWith({ token: 'abc123', password: 'NewPass123!' });
    expect(await screen.findByText(/mot de passe mis à jour/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /aller à la connexion/i })).toBeInTheDocument();
  });

  it('affiche une erreur si la réinitialisation échoue', async () => {
    mockedApiClient.resetPassword.mockRejectedValueOnce(new Error('Invalid token'));

    render(<ResetPasswordPage />);
    const user = userEvent.setup();

    const passwordInput = await screen.findByLabelText(/nouveau mot de passe/i);
    await waitFor(() => expect(screen.getByLabelText(/token/i)).toHaveValue('abc123'));
    await user.type(passwordInput, 'NewPass123!');
    await user.click(screen.getByRole('button', { name: /mettre à jour/i }));

    expect(mockedApiClient.resetPassword).toHaveBeenCalled();
    expect(await screen.findByText(/invalid token/i)).toBeInTheDocument();
  });
});
