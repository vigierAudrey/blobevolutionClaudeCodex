/**
 * Tests — carte "Page publique" (/pros/[slug]) sur la page profil pro.
 * Couvre : activation (consentement + ville requis), lien copiable, désactivation.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProProfilePage from '../page';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { apiRequest } from '@/lib/csrf';

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));

jest.mock('@/lib/apiClient', () => ({
  apiClient: { me: jest.fn(), getTokens: jest.fn() },
}));

jest.mock('@/lib/csrf', () => ({ apiRequest: jest.fn() }));

jest.mock('@/components/ui/toast', () => ({ useToast: jest.fn(() => jest.fn()) }));

jest.mock('@/components/BackBar', () => ({ BackBar: () => <div data-testid="backbar" /> }));

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
  PRO_BETA_INFO_MESSAGE: 'Beta',
}));

const mockUseRouter = useRouter as jest.Mock;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient> & { getTokens: jest.Mock };
const mockApiRequest = apiRequest as jest.Mock;

const makeResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  json: jest.fn().mockResolvedValue(body),
});

const proMeInactive = {
  businessName: 'TestPro',
  bio: 'Cours de surf',
  emailNotif: false,
  lat: null,
  lng: null,
  radiusKm: 25,
  publicEnabled: false,
  publicCity: null,
  slug: null,
};

const proMeActive = {
  ...proMeInactive,
  publicEnabled: true,
  publicCity: 'Lacanau',
  slug: 'testpro',
};

let mockWriteText: jest.Mock;

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

  (mockApiClient.me as jest.Mock).mockResolvedValue({ role: 'PRO' });
  mockApiClient.getTokens.mockReturnValue({ accessToken: 'test-token' });

  mockWriteText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    configurable: true,
  });
});

describe('Page publique — profil non activé', () => {
  beforeEach(() => {
    mockApiRequest.mockImplementation((url: string) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me') return Promise.resolve(makeResponse(proMeInactive));
      return Promise.resolve(makeResponse({}));
    });
  });

  it('affiche le formulaire d\'activation, pas le lien public', async () => {
    render(<ProProfilePage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /activer ma page publique/i })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/lien de ta page publique/i)).not.toBeInTheDocument();
  });

  it('la checkbox de consentement n\'entre pas en conflit avec le champ "Nom commercial" (regression e2e Playwright)', async () => {
    // Le texte du consentement mentionne "nom commercial" — sans aria-label dédié sur
    // la checkbox, getByLabelText(/nom.*commercial/i) matcherait deux éléments et
    // cassait apps/web/tests/e2e/pro-profile.spec.ts (strict mode violation).
    render(<ProProfilePage />);
    await screen.findByRole('button', { name: /activer ma page publique/i });
    expect(
      screen.getAllByLabelText(/nom.*commercial|nom.*entreprise|business.*name/i),
    ).toHaveLength(1);
    expect(screen.getAllByLabelText(/présentation|bio|description/i)).toHaveLength(1);
  });

  it('active avec ville + consentement → PATCH /pro/me/visibility', async () => {
    const user = userEvent.setup();
    mockApiRequest.mockImplementation((url: string, opts?: { method?: string; body?: string }) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me') return Promise.resolve(makeResponse(proMeInactive));
      if (url === '/pro/me/visibility' && opts?.method === 'PATCH') {
        return Promise.resolve(
          makeResponse({ publicEnabled: true, publicCity: 'Lacanau', slug: 'testpro' }),
        );
      }
      return Promise.resolve(makeResponse({}));
    });

    render(<ProProfilePage />);
    const cityInput = await screen.findByLabelText(/ville affichée publiquement/i);
    await user.type(cityInput, 'Lacanau');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /activer ma page publique/i }));

    await waitFor(() => {
      const call = mockApiRequest.mock.calls.find(([url]) => url === '/pro/me/visibility');
      expect(call).toBeDefined();
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
        publicEnabled: true,
        publicCity: 'Lacanau',
        consent: true,
      });
    });

    expect(await screen.findByDisplayValue(/\/pros\/testpro/)).toBeInTheDocument();
  });

  it('n\'appelle pas l\'API sans consentement coché', async () => {
    const user = userEvent.setup();
    render(<ProProfilePage />);
    const cityInput = await screen.findByLabelText(/ville affichée publiquement/i);
    await user.type(cityInput, 'Lacanau');
    await user.click(screen.getByRole('button', { name: /activer ma page publique/i }));

    expect(mockApiRequest.mock.calls.some(([url]) => url === '/pro/me/visibility')).toBe(false);
  });
});

describe('Page publique — profil activé', () => {
  beforeEach(() => {
    mockApiRequest.mockImplementation((url: string) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me') return Promise.resolve(makeResponse(proMeActive));
      return Promise.resolve(makeResponse({}));
    });
  });

  it('affiche le lien public et le bouton de désactivation', async () => {
    render(<ProProfilePage />);
    expect(await screen.findByDisplayValue(/\/pros\/testpro/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /désactiver ma page publique/i })).toBeInTheDocument();
  });

  it('copie le lien dans le presse-papiers', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      configurable: true,
    });
    render(<ProProfilePage />);
    await screen.findByDisplayValue(/\/pros\/testpro/);
    await user.click(screen.getByRole('button', { name: /copier le lien/i }));

    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('/pros/testpro'));
  });

  it('désactive → PATCH /pro/me/visibility puis masque le lien', async () => {
    const user = userEvent.setup();
    mockApiRequest.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me') return Promise.resolve(makeResponse(proMeActive));
      if (url === '/pro/me/visibility' && opts?.method === 'PATCH') {
        return Promise.resolve(makeResponse({ publicEnabled: false }));
      }
      return Promise.resolve(makeResponse({}));
    });

    render(<ProProfilePage />);
    await screen.findByDisplayValue(/\/pros\/testpro/);
    await user.click(screen.getByRole('button', { name: /désactiver ma page publique/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /activer ma page publique/i })).toBeInTheDocument();
    });
  });
});
