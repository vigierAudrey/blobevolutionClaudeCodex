import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthForm } from '../AuthForm';
import { apiClient } from '../../lib/apiClient';
import { FRANCE_ONLY_COUNTRY_CODE, PRO_BETA_INFO_MESSAGE } from '../../lib/franceLaunch';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
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

jest.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({
    trackEvent: jest.fn(),
    canTrack: false,
  }),
}));

const mockUseRouter = useRouter as jest.Mock;
const mockUseSearchParams = useSearchParams as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('AuthForm', () => {
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
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockedApiClient.register.mockResolvedValue({ userId: 'user-1' });
  });

  it('affiche le message France-only quand le rôle PRO est sélectionné', async () => {
    render(<AuthForm mode="register" />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/rôle/i), 'PRO');

    expect(screen.getByText(PRO_BETA_INFO_MESSAGE)).toBeInTheDocument();
  });

  it("envoie countryCode=FR lors de l'inscription PRO", async () => {
    render(<AuthForm mode="register" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/email/i), 'pro@test.com');
    await user.type(screen.getByLabelText(/^mot de passe$/i), 'Passw0rd!');
    await user.selectOptions(screen.getByLabelText(/rôle/i), 'PRO');
    await user.click(screen.getByLabelText(/18 ans ou plus/i));
    await user.click(screen.getByLabelText(/j'ai lu et j'accepte les règles de sécurité des sessions/i));
    await user.click(screen.getByRole('button', { name: /créer le compte/i }));

    expect(mockedApiClient.register).toHaveBeenCalledWith({
      email: 'pro@test.com',
      password: 'Passw0rd!',
      role: 'PRO',
      ageConfirmed: true,
      consentAccepted: true,
      countryCode: FRANCE_ONLY_COUNTRY_CODE,
    });
  });

  describe('paramètre intent URL', () => {
    it('intent=pro → rôle PRO pré-sélectionné et sélecteur masqué', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('intent=pro'));
      render(<AuthForm mode="register" />);

      expect(screen.queryByLabelText(/rôle/i)).not.toBeInTheDocument();
      expect(screen.getByText(/tu t'inscris comme/i)).toBeInTheDocument();
      expect(screen.getByText(/pro/i, { selector: 'strong' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /changer de rôle/i })).toBeInTheDocument();
    });

    it('intent=pro → "Changer de rôle" réaffiche le sélecteur', async () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('intent=pro'));
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();

      expect(screen.queryByLabelText(/rôle/i)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /changer de rôle/i }));

      expect(screen.getByLabelText(/rôle/i)).toBeInTheDocument();
    });

    it('intent=matching → rôle RIDER et sélecteur masqué', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('intent=matching'));
      render(<AuthForm mode="register" />);

      expect(screen.queryByLabelText(/rôle/i)).not.toBeInTheDocument();
      expect(screen.getByText(/rider/i, { selector: 'strong' })).toBeInTheDocument();
    });

    it('/register sans intent → sélecteur visible, comportement historique inchangé', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams());
      render(<AuthForm mode="register" />);

      expect(screen.getByLabelText(/rôle/i)).toBeInTheDocument();
      expect(screen.queryByText(/tu t'inscris comme/i)).not.toBeInTheDocument();
    });
  });
});
