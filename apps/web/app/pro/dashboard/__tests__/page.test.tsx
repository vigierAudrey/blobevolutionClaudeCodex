import { render, screen } from '@testing-library/react';
import { ProStatsSection } from '../page';

jest.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ trackEvent: jest.fn() }),
}));

describe('ProStatsSection — wording mise en relation', () => {
  const stats = {
    receivedRequests: 4,
    readNotifications: 2,
    sentContacts: 3,
    connectedContacts: 2,
    pendingContacts: 1,
    connectionRate: 66.7,
    acceptedContacts: 2,
    acceptanceRate: 66.7,
    weeklyNotifications: [],
    weeklyContacts: [],
    activeNearbyRequests: 7,
  };

  it('affiche les nouveaux libelles metier du dashboard pro', () => {
    render(<ProStatsSection stats={stats} />);

    expect(screen.getByText('Mises en relation')).toBeInTheDocument();
    expect(screen.getByText('Demandes en attente')).toBeInTheDocument();
    expect(screen.getByText('Taux de mise en relation')).toBeInTheDocument();
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
