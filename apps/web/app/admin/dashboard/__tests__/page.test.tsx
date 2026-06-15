import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import AdminDashboard from '../page';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getAdminStats: jest.fn(),
    getBlockedConversations: jest.fn(),
    getSecurityEvents: jest.fn(),
    getSecurityLogsSummary: jest.fn(),
    getSystemAlerts: jest.fn(),
    getSecurityHealth: jest.fn(),
    logoutAll: jest.fn(),
    clearTokens: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockUseRouter = useRouter as jest.Mock;

describe('AdminDashboard — erreurs insights', () => {
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

    mockedApiClient.me.mockResolvedValue({ id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' } as never);
    mockedApiClient.getAdminStats.mockResolvedValue({
      totalUsers: 0,
      totalRiders: 0,
      totalPros: 0,
      totalAdmins: 1,
      totalConversations: 0,
      activeUsers: 0,
      reportedProfiles: 0,
    } as never);
    mockedApiClient.getSecurityEvents.mockResolvedValue({ events: [] } as never);
    mockedApiClient.getSecurityLogsSummary.mockResolvedValue({ since: new Date().toISOString(), items: [] } as never);
    mockedApiClient.getSystemAlerts.mockResolvedValue({ items: [] } as never);
    mockedApiClient.getSecurityHealth.mockResolvedValue({
      status: 'SECURE',
      timestamp: new Date().toISOString(),
      checks: { config: 'ok', env: 'ok', db: 'ok', redis: 'ok' },
    } as never);
  });

  it('affiche un message neutre si Conversations bloquées reçoit une 429 backend', async () => {
    mockedApiClient.getBlockedConversations.mockRejectedValue(
      new Error('Too many messages. Please wait before sending more.'),
    );

    render(<AdminDashboard />);

    expect(await screen.findByText('Administration')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Données temporairement indisponibles')).toBeInTheDocument();
    });

    expect(screen.getByText('Conversations bloquées')).toBeInTheDocument();
    expect(screen.queryByText(/Too many messages/i)).not.toBeInTheDocument();
  });
});
