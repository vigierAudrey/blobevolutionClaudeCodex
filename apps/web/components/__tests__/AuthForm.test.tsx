import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter, useSearchParams } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
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
    listConversations: jest.fn(),
    getPendingConversationInvitations: jest.fn(),
    getPendingContactRequests: jest.fn(),
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
    mockedApiClient.register.mockResolvedValue({
      message: 'Account created. Please check your inbox for the verification email.',
      userId: 'user-1',
      emailSent: true,
    });
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

  describe('bloc de confirmation post-inscription', () => {
    const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText(/email/i), 'blob@test.com');
      await user.type(screen.getByLabelText(/^mot de passe$/i), 'Passw0rd!');
      await user.click(screen.getByLabelText(/18 ans ou plus/i));
      await user.click(screen.getByLabelText(/j'ai lu et j'accepte les règles de sécurité des sessions/i));
      await user.click(screen.getByRole('button', { name: /créer le compte/i }));
    };

    it('affiche le bloc confirmation après inscription réussie', async () => {
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      expect(screen.getByText(/vérifie ta boîte mail/i)).toBeInTheDocument();
      expect(screen.getByText(/blob@test\.com/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /aller à la connexion/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /renvoyer l'email/i })).toBeInTheDocument();
    });

    it("confirme l'envoi uniquement quand register retourne emailSent:true", async () => {
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      expect(screen.getByText(/on vient d'envoyer un lien de confirmation/i)).toBeInTheDocument();
    });

    it("affiche un état honnête et sans détail interne quand register retourne emailSent:false", async () => {
      mockedApiClient.register.mockResolvedValue({
        message: "Account created. If you don't receive the email, use the resend button.",
        userId: 'user-1',
        emailSent: false,
      });
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      expect(screen.queryByText(/on vient d'envoyer/i)).not.toBeInTheDocument();
      expect(screen.getByText(/ton compte a été créé, mais l'email de vérification n'a pas pu être envoyé/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /renvoyer l'email/i })).toBeInTheDocument();
      expect(screen.queryByText(/smtp|brevo|provider|stack/i)).not.toBeInTheDocument();
    });

    it("ne suppose pas l'envoi réussi quand emailSent est absent", async () => {
      mockedApiClient.register.mockResolvedValue({ message: 'Account created.', userId: 'user-1' });
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      expect(screen.queryByText(/on vient d'envoyer/i)).not.toBeInTheDocument();
      expect(screen.getByText(/l'email de vérification n'a pas pu être envoyé/i)).toBeInTheDocument();
    });

    it('ne redirige pas automatiquement après inscription', async () => {
      const mockPush = jest.fn();
      mockUseRouter.mockReturnValue({ push: mockPush, replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() });
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('navigue vers /login via le bouton "Aller à la connexion"', async () => {
      const mockPush = jest.fn();
      mockUseRouter.mockReturnValue({ push: mockPush, replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() });
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      await user.click(screen.getByRole('button', { name: /aller à la connexion/i }));

      expect(mockPush).toHaveBeenCalledWith('/login');
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("appelle resendVerification et désactive le bouton pendant l'envoi", async () => {
      let resolveResend!: () => void;
      mockedApiClient.resendVerification.mockReturnValue(new Promise<void>((res) => { resolveResend = res; }));
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      const btn = screen.getByRole('button', { name: /renvoyer l'email/i });
      await user.click(btn);

      expect(mockedApiClient.resendVerification).toHaveBeenCalledWith('blob@test.com');
      expect(screen.getByRole('button', { name: /envoi/i })).toBeDisabled();

      resolveResend();
      await screen.findByText(/demande de renvoi prise en compte/i);
    });

    it('affiche un message neutre si resend échoue', async () => {
      mockedApiClient.resendVerification.mockRejectedValue(new Error('network error'));
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      await user.click(screen.getByRole('button', { name: /renvoyer l'email/i }));

      await screen.findByText(/impossible de renvoyer l'email pour le moment/i);
    });

    it('"Changer d\'adresse email" revient au formulaire sans l\'email dans l\'URL', async () => {
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();
      await fillAndSubmit(user);

      await user.click(screen.getByRole('button', { name: /changer d'adresse email/i }));

      expect(screen.getByRole('button', { name: /créer le compte/i })).toBeInTheDocument();
      expect(window.location.search).not.toContain('blob@test.com');
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

  describe('états de soumission', () => {
    const fillRegisterForm = async (user: ReturnType<typeof userEvent.setup>, email = 'rate-limit@test.com') => {
      await user.type(screen.getByLabelText(/email/i), email);
      await user.type(screen.getByLabelText(/^mot de passe$/i), 'Passw0rd!');
      await user.click(screen.getByLabelText(/18 ans ou plus/i));
      await user.click(screen.getByLabelText(/j'ai lu et j'accepte les règles de sécurité des sessions/i));
    };

    it("déclenche un seul appel register même si le formulaire est soumis deux fois très vite", async () => {
      mockedApiClient.register.mockReturnValue(new Promise(() => undefined));
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();

      await fillRegisterForm(user, 'fast-submit@test.com');

      const submitButton = screen.getByRole('button', { name: /créer le compte/i });
      const form = submitButton.closest('form');
      expect(form).not.toBeNull();

      fireEvent.submit(form as HTMLFormElement);
      fireEvent.submit(form as HTMLFormElement);

      expect(mockedApiClient.register).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /en cours/i })).toBeDisabled();
    });

    it("libère le verrou register après une erreur", async () => {
      mockedApiClient.register
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ message: 'Account created.', userId: 'user-2', emailSent: true });
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();

      await fillRegisterForm(user, 'retry-submit@test.com');

      await user.click(screen.getByRole('button', { name: /créer le compte/i }));
      expect(await screen.findByText(/une erreur est survenue/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /créer le compte/i }));

      expect(mockedApiClient.register).toHaveBeenCalledTimes(2);
      expect(await screen.findByText(/vérifie ta boîte mail/i)).toBeInTheDocument();
    });

    it('désactive le CTA de connexion pendant la requête', async () => {
      mockedApiClient.login.mockReturnValue(new Promise(() => undefined));
      render(<AuthForm mode="login" />);
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/email/i), 'rider@test.com');
      await user.type(screen.getByLabelText(/^mot de passe$/i), 'Passw0rd!');
      await user.click(screen.getByRole('button', { name: /se connecter/i }));

      expect(screen.getByRole('button', { name: /en cours/i })).toBeDisabled();
      expect(mockedApiClient.login).toHaveBeenCalledTimes(1);
    });

    it('affiche le message register 429 uniquement quand register renvoie un 429', async () => {
      const rateLimitError = Object.assign(new Error('REGISTRATION_RATE_LIMIT_EXCEEDED'), {
        status: 429,
        body: {
          error: 'REGISTRATION_RATE_LIMIT_EXCEEDED',
          message: 'Trop de tentatives. Réessaie dans quelques minutes.',
        },
      });
      mockedApiClient.register.mockRejectedValue(rateLimitError);
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();

      expect(screen.queryByText('Trop de tentatives. Réessaie dans quelques minutes.')).not.toBeInTheDocument();

      await fillRegisterForm(user, 'register-429@test.com');
      await user.click(screen.getByRole('button', { name: /créer le compte/i }));

      expect(await screen.findByText('Trop de tentatives. Réessaie dans quelques minutes.')).toBeInTheDocument();
      expect(mockedApiClient.register).toHaveBeenCalledTimes(1);
    });

    it('ne déclenche aucun appel privé conversations/contact depuis le register avant authentification', async () => {
      render(<AuthForm mode="register" />);
      const user = userEvent.setup();

      expect(mockedApiClient.me).not.toHaveBeenCalled();
      expect(mockedApiClient.listConversations).not.toHaveBeenCalled();
      expect(mockedApiClient.getPendingConversationInvitations).not.toHaveBeenCalled();
      expect(mockedApiClient.getPendingContactRequests).not.toHaveBeenCalled();

      await fillRegisterForm(user, 'no-private-calls@test.com');
      await user.click(screen.getByRole('button', { name: /créer le compte/i }));
      await screen.findByText(/vérifie ta boîte mail/i);

      expect(mockedApiClient.me).not.toHaveBeenCalled();
      expect(mockedApiClient.listConversations).not.toHaveBeenCalled();
      expect(mockedApiClient.getPendingConversationInvitations).not.toHaveBeenCalled();
      expect(mockedApiClient.getPendingContactRequests).not.toHaveBeenCalled();
    });
  });

  describe('i18n', () => {
    it('bascule intégralement en anglais avec un provider locale "en"', () => {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Europe/Paris">
          <AuthForm mode="register" />
        </NextIntlClientProvider>,
      );

      expect(screen.getByRole('heading', { name: /sign up/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create the account/i })).toBeInTheDocument();
      expect(screen.getByText(/session safety & responsibility/i)).toBeInTheDocument();
      expect(screen.getByText(/your password must include:/i)).toBeInTheDocument();

      // Aucun résidu français sur le formulaire anglophone
      expect(screen.queryByText(/Créer le compte|Mot de passe|Sécurité des sessions/)).not.toBeInTheDocument();
    });

    it('affiche les erreurs serveur classifiées dans la langue active', async () => {
      mockedApiClient.login.mockRejectedValue(new Error('Invalid credentials'));
      render(
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Europe/Paris">
          <AuthForm mode="login" />
        </NextIntlClientProvider>,
      );
      const user = userEvent.setup();

      await user.type(screen.getByLabelText('Email'), 'rider@test.com');
      await user.type(screen.getByLabelText('Password'), 'Password!234');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    });
  });
});
