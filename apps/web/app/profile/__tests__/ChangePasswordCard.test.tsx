import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/ui/toast';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    changePassword: jest.fn(),
  },
}));

jest.mock('@/components/ui/toast', () => ({
  useToast: jest.fn(),
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedUseToast = useToast as jest.Mock;

describe('ChangePasswordCard', () => {
  beforeEach(() => {
    mockedUseToast.mockReturnValue(jest.fn());
    jest.clearAllMocks();
  });

  async function openCard(user: ReturnType<typeof userEvent['setup']>) {
    await user.click(screen.getByRole('button', { name: /sécurité du compte/i }));
  }

  it('envoie la requête quand les champs sont valides', async () => {
    mockedApiClient.changePassword.mockResolvedValueOnce({});

    render(<ChangePasswordCard />);
    const user = userEvent.setup();
    await openCard(user);

    await user.type(screen.getByLabelText(/mot de passe actuel/i), 'OldPass123!');
    await user.type(screen.getByLabelText(/^nouveau mot de passe/i), 'NewPass123!');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'NewPass123!');
    await user.click(screen.getByRole('button', { name: /mettre à jour le mot de passe/i }));

    expect(mockedApiClient.changePassword).toHaveBeenCalledWith({
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
    });
    expect(await screen.findByText(/mot de passe mis à jour/i)).toBeInTheDocument();
  });

  it('bloque la soumission quand les mots de passe ne correspondent pas', async () => {
    render(<ChangePasswordCard />);
    const user = userEvent.setup();
    await openCard(user);

    await user.type(screen.getByLabelText(/mot de passe actuel/i), 'OldPass123!');
    await user.type(screen.getByLabelText(/^nouveau mot de passe/i), 'NewPass123!');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'Mismatch123!');
    await user.click(screen.getByRole('button', { name: /mettre à jour le mot de passe/i }));

    expect(mockedApiClient.changePassword).not.toHaveBeenCalled();
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
  });

  it('affiche une erreur générique si l’API échoue', async () => {
    mockedApiClient.changePassword.mockRejectedValueOnce(new Error('Invalid current password'));

    render(<ChangePasswordCard />);
    const user = userEvent.setup();
    await openCard(user);

    await user.type(screen.getByLabelText(/mot de passe actuel/i), 'OldPass123!');
    await user.type(screen.getByLabelText(/^nouveau mot de passe/i), 'NewPass123!');
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), 'NewPass123!');
    await user.click(screen.getByRole('button', { name: /mettre à jour le mot de passe/i }));

    expect(mockedApiClient.changePassword).toHaveBeenCalled();
    expect(await screen.findByText(/impossible de mettre à jour le mot de passe/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid current password/i)).not.toBeInTheDocument();
  });
});
