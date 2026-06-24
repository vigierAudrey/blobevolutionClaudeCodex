import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProfilePage from '../page';
import { apiClient } from '@/lib/apiClient';
import { apiRequest } from '@/lib/csrf';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

jest.mock('@/lib/csrf', () => ({
  apiRequest: jest.fn(),
}));

jest.mock('@/components/BackBar', () => ({
  BackBar: () => <div data-testid="backbar" />,
}));

jest.mock('@/components/ui/toast', () => ({
  useToast: jest.fn(() => jest.fn()),
}));

jest.mock('@/components/ui/spinner', () => ({
  Spinner: () => <span data-testid="spinner" />,
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

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockApiRequest = apiRequest as jest.Mock;

const makeResponse = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  json: jest.fn().mockResolvedValue(body),
  blob: jest.fn().mockResolvedValue(new Blob()),
});

describe('ProfilePage — préférences d\'alertes rider', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (mockApiClient.getProfile as jest.Mock).mockResolvedValue({
      displayName: 'Blob Rider',
      bio: '',
      sex: 'UNSPECIFIED',
      hasPhoto: false,
      photoEndpoint: null,
      emailNotif: false,
      lat: null,
      lng: null,
    });
    (mockApiClient.getDisciplines as jest.Mock).mockResolvedValue([]);

    mockApiRequest.mockImplementation((url: string) => {
      if (url === '/profile/notifications') {
        return Promise.resolve(makeResponse({
          role: 'RIDER',
          preferences: {
            inAppEnabled: true,
            pushEnabled: true,
            notifyMessages: true,
            notifyMatches: true,
            notifyInvitations: true,
          },
        }));
      }
      if (url === '/profile/deletion-status') {
        return Promise.resolve(makeResponse({ isScheduled: false }));
      }
      return Promise.resolve(makeResponse({}));
    });
  });

  it('sépare les canaux (in-app / push) des événements, sans forcer de prompt navigateur au chargement', async () => {
    const requestPermission = jest.fn();
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission },
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/préférences d'alertes/i)).toBeInTheDocument();
    });

    // Canaux de diffusion explicites : in-app (cloche) vs push (appareil).
    expect(screen.getByText(/dans blob \(cloche\)/i)).toBeInTheDocument();
    expect(screen.getByText(/push \(téléphone \/ navigateur\)/i)).toBeInTheDocument();

    // Événements (s'appliquent aux canaux activés).
    expect(screen.getAllByText(/messages/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/nouveaux matchs/i)).toBeInTheDocument();
    expect(screen.getByText(/invitations groupe/i)).toBeInTheDocument();

    // La copie ne doit plus prétendre que tout se passe uniquement "dans Blob".
    expect(screen.queryByText(/réactive les alertes dans blob pour voir/i)).not.toBeInTheDocument();

    // Activer le canal push est une préférence : aucun prompt navigateur forcé au chargement.
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('les masters de canal ne sont pas décoratifs : leur état part dans le PUT', async () => {
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/préférences d'alertes/i)).toBeInTheDocument();
    });

    // Coupe les deux canaux puis sauvegarde.
    fireEvent.click(screen.getByRole('button', { name: /dans blob \(cloche\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /push \(téléphone \/ navigateur\)/i }));

    // L'avertissement "aucun canal activé" doit apparaître.
    expect(screen.getByText(/aucun canal activé/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sauvegarder mes préférences/i }));

    await waitFor(() => {
      const putCall = mockApiRequest.mock.calls.find(
        ([url, opts]) => url === '/profile/notifications' && opts?.method === 'PUT',
      );
      expect(putCall).toBeDefined();
      const payload = JSON.parse(putCall![1].body as string);
      expect(payload.inAppEnabled).toBe(false);
      expect(payload.pushEnabled).toBe(false);
    });
  });
});
