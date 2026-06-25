/**
 * Non-regression : vérifie que la section RGPD est toujours présente sur la page profil
 * et que les éléments notifications extraits n'y figurent plus.
 */
import { render, screen, waitFor } from '@testing-library/react';
import ProProfilePage from '../page';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { apiRequest } from '@/lib/csrf';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: { me: jest.fn(), getTokens: jest.fn() },
}));

jest.mock('@/lib/csrf', () => ({
  apiRequest: jest.fn(),
}));

jest.mock('@/components/ui/toast', () => ({
  useToast: jest.fn(() => jest.fn()),
}));

jest.mock('@/components/BackBar', () => ({
  BackBar: () => <div data-testid="backbar" />,
}));

jest.mock('@/components/profile/ChangePasswordCard', () => ({
  ChangePasswordCard: () => <div data-testid="change-password-card" />,
}));

jest.mock('@/components/cookies/CookieConsent', () => ({
  COOKIE_CONSENT_REOPEN_EVENT: 'cookie-consent-reopen',
  useCookieConsent: () => ({
    updateConsent: jest.fn(),
    consentReady: true,
    consentLevel: 'essential',
  }),
}));

jest.mock('@/lib/franceLaunch', () => ({
  FRANCE_ONLY_COUNTRY_CODE: 'FR',
  FRANCE_ONLY_INFO_MESSAGE: 'France uniquement',
}));

const mockUseRouter = useRouter as jest.Mock;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient> & { getTokens: jest.Mock };
const mockApiRequest = apiRequest as jest.Mock;

const makeResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: jest.fn().mockResolvedValue(body),
  blob: jest.fn().mockResolvedValue(new Blob()),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRouter.mockReturnValue({
    replace: jest.fn(),
    push: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  });

  mockApiClient.me.mockResolvedValue({ role: 'PRO' } as never);
  mockApiClient.getTokens.mockReturnValue({ accessToken: 'test-token' });
  mockApiRequest.mockImplementation((url: string) => {
    if (url === '/pro/me') return Promise.resolve(makeResponse({ businessName: 'TestPro', bio: '', emailNotif: false }));
    if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
    return Promise.resolve(makeResponse({}));
  });
});

describe('ProProfilePage — non-regression RGPD', () => {
  it('affiche le header Blob du profil pro avec CTA aperçu', async () => {
    render(<ProProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /profil professionnel/i })).toBeInTheDocument();
    });

    expect(screen.getByTestId('preview-button')).toHaveAttribute('href', '/pro/profile/preview');
  });

  it('affiche toujours la section RGPD', async () => {
    render(<ProProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/confidentialité & rgpd/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/vos droits rgpd/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exporter mes données/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /supprimer mon compte/i })).toBeInTheDocument();
  });

  it('affiche la section Géolocalisation', async () => {
    render(<ProProfilePage />);

    // heading h3 specifique, distinct du texte du paragraphe fallback
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /géolocalisation/i })).toBeInTheDocument();
    });
  });

  it('affiche la section Préférences de confidentialité', async () => {
    render(<ProProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/préférences de confidentialité/i)).toBeInTheDocument();
    });
  });

  it('affiche des préférences d\'alertes pro avec un contrôle push navigateur honnête (aucun prompt au chargement)', async () => {
    const requestPermission = jest.fn();
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission },
    });

    render(<ProProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/préférences d'alertes/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText(/alertes dans blob/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/messages/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/demandes de cours/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/demandes surf/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/demandes kitesurf/i).length).toBeGreaterThan(0);
    // Le push navigateur est désormais câblé, mais honnêtement : aucune promesse
    // d'abonnement automatique de "ce navigateur", et surtout aucun prompt de
    // permission déclenché au simple chargement de la page.
    expect(screen.queryByText(/ce navigateur est (abonné|configuré)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reçois des alertes instantanées/i)).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('conserve la préférence email notif dans la section alertes', async () => {
    render(<ProProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/alertes par email/i)).toBeInTheDocument();
    });

    // Le toggle email est un bouton accessible avec aria-label
    expect(
      screen.getByRole('button', { name: /activer les alertes email/i }),
    ).toBeInTheDocument();
  });
});
