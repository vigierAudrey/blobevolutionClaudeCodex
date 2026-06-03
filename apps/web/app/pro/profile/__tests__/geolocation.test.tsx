/**
 * Tests — géolocalisation pro sur la page profil (Option B)
 * Couvre : activer, actualiser, supprimer la position, slider rayon.
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProProfilePage from '../page';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import { apiRequest } from '@/lib/csrf';

// ── mocks communs ──────────────────────────────────────────────────────────
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

// ── helpers ────────────────────────────────────────────────────────────────
const mockUseRouter = useRouter as jest.Mock;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient> & { getTokens: jest.Mock };
const mockApiRequest = apiRequest as jest.Mock;

const makeResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  json: jest.fn().mockResolvedValue(body),
});

const proMeWithLocation = {
  businessName: 'TestPro',
  bio: '',
  emailNotif: false,
  lat: 43.6,
  lng: -1.4,
  radiusKm: 30,
};

const proMeNoLocation = {
  businessName: 'TestPro',
  bio: '',
  emailNotif: false,
  lat: null,
  lng: null,
  radiusKm: 25,
};

let mockGetCurrentPosition: jest.Mock;

beforeAll(() => {
  mockGetCurrentPosition = jest.fn();
  Object.defineProperty(global.navigator, 'geolocation', {
    value: { getCurrentPosition: mockGetCurrentPosition },
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();

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

  mockApiRequest.mockImplementation((url: string) => {
    if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
    if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
    if (url === '/pro/me') return Promise.resolve(makeResponse(proMeWithLocation));
    return Promise.resolve(makeResponse({}));
  });
});

// ── suite sans position ─────────────────────────────────────────────────────
describe('Géolocalisation — aucune position enregistrée', () => {
  beforeEach(() => {
    mockApiRequest.mockImplementation((url: string) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me') return Promise.resolve(makeResponse(proMeNoLocation));
      return Promise.resolve(makeResponse({}));
    });
  });

  it('affiche le bouton "Activer ma géolocalisation"', async () => {
    render(<ProProfilePage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /activer ma géolocalisation/i })).toBeInTheDocument();
    });
  });

  it('n\'affiche pas les boutons Actualiser / Supprimer', async () => {
    render(<ProProfilePage />);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /actualiser ma position/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /supprimer ma position/i })).not.toBeInTheDocument();
    });
  });

  it('GPS réussi → appelle PUT /pro/me, affiche Position active', async () => {
    const user = userEvent.setup();
    mockGetCurrentPosition.mockImplementation(
      (success: PositionCallback) => success({ coords: { latitude: 44.1, longitude: -1.2 } } as GeolocationPosition)
    );
    // PUT /pro/me retourne le profil mis à jour
    mockApiRequest.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me' && opts?.method === 'GET') return Promise.resolve(makeResponse(proMeNoLocation));
      if (url === '/pro/me' && opts?.method === 'PUT') return Promise.resolve(makeResponse({}));
      return Promise.resolve(makeResponse({}));
    });

    render(<ProProfilePage />);
    const btn = await screen.findByRole('button', { name: /activer ma géolocalisation/i });
    await user.click(btn);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/pro/me',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"lat":44.1'),
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/position active/i)).toBeInTheDocument();
    });
  });

  it('GPS refusé → affiche message permission refusée', async () => {
    const user = userEvent.setup();
    mockGetCurrentPosition.mockImplementation(
      (_: unknown, error: PositionErrorCallback) =>
        error({ code: 1, message: 'denied' } as GeolocationPositionError)
    );

    render(<ProProfilePage />);
    const btn = await screen.findByRole('button', { name: /activer ma géolocalisation/i });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/permission refusée/i)).toBeInTheDocument();
    });
  });
});

// ── suite avec position ────────────────────────────────────────────────────
describe('Géolocalisation — position déjà enregistrée', () => {
  it('affiche les boutons Actualiser et Supprimer', async () => {
    render(<ProProfilePage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /actualiser ma position/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /supprimer ma position/i })).toBeInTheDocument();
    });
  });

  it('affiche le champ rayon avec la valeur chargée', async () => {
    render(<ProProfilePage />);
    await waitFor(() => {
      const input = screen.getByLabelText(/rayon de recherche/i) as HTMLInputElement;
      expect(input.value).toBe('30');
    });
  });

  it('Actualiser → GPS réussi → appelle PUT /pro/me avec nouvelles coords', async () => {
    const user = userEvent.setup();
    mockGetCurrentPosition.mockImplementation(
      (success: PositionCallback) => success({ coords: { latitude: 43.7, longitude: -1.5 } } as GeolocationPosition)
    );
    mockApiRequest.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me' && (!opts?.method || opts.method === 'GET')) return Promise.resolve(makeResponse(proMeWithLocation));
      if (url === '/pro/me' && opts?.method === 'PUT') return Promise.resolve(makeResponse({}));
      return Promise.resolve(makeResponse({}));
    });

    render(<ProProfilePage />);
    const btn = await screen.findByRole('button', { name: /actualiser ma position/i });
    await user.click(btn);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        '/pro/me',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"lat":43.7'),
        })
      );
    });
  });

  it('Actualiser → GPS refusé → affiche message permission refusée', async () => {
    const user = userEvent.setup();
    mockGetCurrentPosition.mockImplementation(
      (_: unknown, error: PositionErrorCallback) =>
        error({ code: 1, message: 'denied' } as GeolocationPositionError)
    );

    render(<ProProfilePage />);
    const btn = await screen.findByRole('button', { name: /actualiser ma position/i });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/permission refusée/i)).toBeInTheDocument();
    });
  });

  it('Supprimer → appelle PUT /pro/me sans lat/lng, masque la position', async () => {
    const user = userEvent.setup();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    mockApiRequest.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me' && (!opts?.method || opts.method === 'GET')) return Promise.resolve(makeResponse(proMeWithLocation));
      if (url === '/pro/me' && opts?.method === 'PUT') return Promise.resolve(makeResponse({}));
      return Promise.resolve(makeResponse({}));
    });

    render(<ProProfilePage />);
    const btn = await screen.findByRole('button', { name: /supprimer ma position/i });
    await user.click(btn);

    await waitFor(() => {
      const putCall = (mockApiRequest as jest.Mock).mock.calls.find(
        ([url, opts]: [string, { method?: string; body?: string }]) =>
          url === '/pro/me' && opts?.method === 'PUT'
      );
      expect(putCall).toBeDefined();
      // lat/lng doivent être absents du body (undefined sérialisé → absent)
      expect(putCall[1].body).not.toContain('"lat"');
      expect(putCall[1].body).not.toContain('"lng"');
    });

    await waitFor(() => {
      expect(screen.queryByText(/position active/i)).not.toBeInTheDocument();
    });
  });

  it('changement de rayon → appelle PATCH /pro/me après debounce', async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockApiRequest.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === '/pro/deletion-status') return Promise.resolve(makeResponse({ isScheduled: false }));
      if (url === '/profile/notifications') return Promise.resolve(makeResponse({}));
      if (url === '/pro/me' && (!opts?.method || opts.method === 'GET')) return Promise.resolve(makeResponse(proMeWithLocation));
      if (url === '/pro/me' && opts?.method === 'PATCH') return Promise.resolve(makeResponse({}));
      return Promise.resolve(makeResponse({}));
    });

    render(<ProProfilePage />);
    const input = await screen.findByLabelText(/rayon de recherche/i);

    await user.clear(input);
    await user.type(input, '50');

    // Avant debounce : PATCH pas encore appelé
    const patchCallsBefore = (mockApiRequest as jest.Mock).mock.calls.filter(
      ([url, opts]: [string, { method?: string }]) => url === '/pro/me' && opts?.method === 'PATCH'
    );
    expect(patchCallsBefore.length).toBe(0);

    // Avance les timers de 600ms (> debounce 500ms)
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    await waitFor(() => {
      const patchCalls = (mockApiRequest as jest.Mock).mock.calls.filter(
        ([url, opts]: [string, { method?: string }]) => url === '/pro/me' && opts?.method === 'PATCH'
      );
      expect(patchCalls.length).toBeGreaterThan(0);
    });

    jest.useRealTimers();
  });
});
