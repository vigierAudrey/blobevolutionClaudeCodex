import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgotPasswordPage from '../page';
import { apiClient } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('envoie une demande de réinitialisation quand le formulaire est valide', async () => {
    mockedApiClient.requestPasswordReset.mockResolvedValueOnce({});

    render(<ForgotPasswordPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'user@test.com');
    await user.click(screen.getByRole('button', { name: /envoyer/i }));

    expect(mockedApiClient.requestPasswordReset).toHaveBeenCalledWith('user@test.com');
    expect(await screen.findByText(/un email de réinitialisation/i)).toBeInTheDocument();
  });

  it('affiche une erreur si la requête échoue', async () => {
    mockedApiClient.requestPasswordReset.mockRejectedValueOnce(new Error('Erreur réseau'));

    render(<ForgotPasswordPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'user@test.com');
    await user.click(screen.getByRole('button', { name: /envoyer/i }));

    expect(mockedApiClient.requestPasswordReset).toHaveBeenCalled();
    expect(await screen.findByText(/erreur réseau/i)).toBeInTheDocument();
  });
});
