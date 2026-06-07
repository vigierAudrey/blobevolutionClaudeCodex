import { render, screen, waitFor } from '@testing-library/react';
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

  it('affiche les alertes rider sans libellé push ni prompt navigateur', async () => {
    const requestPermission = jest.fn();
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission },
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText(/préférences d'alertes/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText(/alertes dans blob/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/messages/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/nouveaux matchs/i)).toBeInTheDocument();
    expect(screen.getByText(/invitations groupe/i)).toBeInTheDocument();
    expect(screen.queryByText(/notifications push/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reçois des alertes instantanées/i)).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
