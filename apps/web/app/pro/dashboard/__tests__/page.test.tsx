import { render, screen, waitFor } from '@testing-library/react';
import { ProStatsSection } from '../ProStatsSection';
import ProDashboardPage from '../page';
import { optimizedApiClient } from '@/lib/optimizedApiClient';
import { useRouter } from 'next/navigation';
import { useAnalytics } from '@/hooks/useAnalytics';

jest.mock('@/lib/optimizedApiClient', () => ({
  optimizedApiClient: {
    getTokens: jest.fn(),
    me: jest.fn(),
    getProDashboardStats: jest.fn(),
    logoutAll: jest.fn(),
    clearTokens: jest.fn(),
  },
}));

jest.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: jest.fn(),
}));

jest.mock('@/components/NotificationBell', () => ({
  NotificationBell: () => <span data-testid="notification-bell" />,
}));

const mockedOptimizedApiClient = optimizedApiClient as jest.Mocked<typeof optimizedApiClient>;
const mockUseRouter = useRouter as jest.Mock;
const mockUseAnalytics = useAnalytics as jest.Mock;

describe('ProStatsSection — wording mise en relation', () => {
  const stats = {
    receivedRequests: 4,
    readNotifications: 2,
    sentContacts: 3,
    connectedContacts: 2,
    pendingContacts: 1,
    connectionRate: 66.7,
    conversationsStartedCount: 1,
    conversationStartRate: 50,
    acceptedContacts: 2,
    acceptanceRate: 66.7,
    weeklyNotifications: [],
    weeklyContacts: [],
    activeNearbyRequests: 7,
  };

  it('affiche les nouveaux libelles metier du dashboard pro', () => {
    render(<ProStatsSection stats={stats} />);

    expect(screen.getByText('Mises en relation')).toBeInTheDocument();
    expect(screen.getByText('Conversations démarrées')).toBeInTheDocument();
    expect(screen.getByText('Demandes en attente')).toBeInTheDocument();
    expect(screen.getByText('Taux de mise en relation')).toBeInTheDocument();
    expect(screen.getByText('Mise en relation → conversation')).toBeInTheDocument();
    expect(screen.getByText('mises en relation / demandes envoyées')).toBeInTheDocument();
    expect(screen.queryByText(/cours accepté/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/réservation acceptée/i)).not.toBeInTheDocument();
  });

  it('reste compatible avec les alias legacy du DTO', () => {
    render(
      <ProStatsSection
        stats={{
          ...stats,
          connectedContacts: undefined as unknown as number,
          pendingContacts: undefined as unknown as number,
          connectionRate: undefined as unknown as number | null,
        }}
      />,
    );

    expect(screen.getByText('Mises en relation')).toBeInTheDocument();
    expect(screen.getByText('66.7%')).toBeInTheDocument();
  });
});

describe('ProDashboardPage — harmonisation Blob', () => {
  const replace = jest.fn();
  const stats = {
    receivedRequests: 4,
    readNotifications: 2,
    sentContacts: 3,
    connectedContacts: 2,
    pendingContacts: 1,
    connectionRate: 66.7,
    conversationsStartedCount: 1,
    conversationStartRate: 50,
    acceptedContacts: 2,
    acceptanceRate: 66.7,
    weeklyNotifications: [],
    weeklyContacts: [],
    activeNearbyRequests: 7,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({
      replace,
      push: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    mockUseAnalytics.mockReturnValue({ trackEvent: jest.fn() });
    mockedOptimizedApiClient.getTokens.mockReturnValue({ accessToken: 'token' } as never);
    mockedOptimizedApiClient.me.mockResolvedValue({
      id: 'pro-1',
      email: 'pro@example.test',
      role: 'PRO',
      emailVerified: true,
    } as never);
    mockedOptimizedApiClient.getProDashboardStats.mockResolvedValue(stats as never);
  });

  it('affiche les CTA pro reliés aux routes MVP', async () => {
    render(<ProDashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Pilote tes demandes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ouvrir mon profil/i })).toHaveAttribute('href', '/pro/profile');
    expect(screen.getByRole('link', { name: /ouvrir mes messages/i })).toHaveAttribute('href', '/pro/messages');
    expect(screen.getByRole('link', { name: /voir la carte/i })).toHaveAttribute('href', '/pro/map');
    expect(
      screen.getAllByRole('link', { name: /gérer les demandes/i }).some((link) => link.getAttribute('href') === '/pro/contact-requests'),
    ).toBe(true);
    expect(screen.getByRole('link', { name: /régler mes alertes/i })).toHaveAttribute('href', '/pro/settings/notifications');
    expect(replace).not.toHaveBeenCalledWith('/dashboard');
  });

  it('redirige hors dashboard pro si le rôle serveur n’est pas PRO', async () => {
    mockedOptimizedApiClient.me.mockResolvedValueOnce({
      id: 'rider-1',
      email: 'rider@example.test',
      role: 'RIDER',
      emailVerified: true,
    } as never);

    render(<ProDashboardPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/dashboard');
    });
  });
});
