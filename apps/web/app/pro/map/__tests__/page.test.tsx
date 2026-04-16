import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useRouter } from 'next/navigation';
import ProMapPage from '../page';
import { apiClient } from '../../../../lib/apiClient';
import { apiRequest } from '../../../../lib/csrf';
import { useToast } from '../../../../components/ui/toast';
import { FRANCE_ONLY_COPY } from '../../../../lib/france-only';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('next/dynamic', () => () => {
  const MockDynamic = () => <div data-testid="mock-map" />;
  return MockDynamic;
});

jest.mock('../../../../lib/apiClient', () => ({
  apiClient: {
    getTokens: jest.fn(),
  },
}));

jest.mock('../../../../lib/csrf', () => ({
  apiRequest: jest.fn(),
}));

jest.mock('../../../../components/ui/toast', () => ({
  useToast: jest.fn(),
}));

const mockedUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedApiRequest = apiRequest as jest.Mock;
const mockedUseToast = useToast as jest.Mock;

describe('Pro map France-only UX', () => {
  const mockToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseRouter.mockReturnValue({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    mockedUseToast.mockReturnValue(mockToast);
    mockedApiClient.getTokens.mockReturnValue({ accessToken: 'token', refreshToken: 'refresh' });
    mockedApiRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ radiusKm: 25 }),
    });

    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: jest.fn((success: PositionCallback) => {
          success({
            coords: {
              latitude: 41.3874,
              longitude: 2.1686,
            },
          } as GeolocationPosition);
        }),
      },
    });
  });

  it('shows an informational toast and avoids persisting a pro location outside France', async () => {
    const user = userEvent.setup();

    render(<ProMapPage />);

    const button = await screen.findByRole('button', { name: /activer ma géolocalisation/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(FRANCE_ONLY_COPY.proProfile, 'info', 4000);
    });
    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(mockedApiRequest).toHaveBeenCalledWith('/pro/me', expect.objectContaining({ method: 'GET' }));
  });
});
