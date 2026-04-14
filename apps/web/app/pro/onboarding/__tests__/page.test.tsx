import { render, screen, waitFor } from '@testing-library/react';
import ProOnboardingPage from '../page';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
  },
}));

const mockUseRouter = useRouter as jest.Mock;
const mockUseSearchParams = useSearchParams as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const createJsonResponse = (body: unknown, init: { ok: boolean; status?: number }) => ({
  ok: init.ok,
  status: init.status ?? (init.ok ? 200 : 500),
  json: jest.fn().mockResolvedValue(body),
});

describe('ProOnboardingPage', () => {
  const replace = jest.fn();
  const push = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    replace.mockReset();
    push.mockReset();
    mockUseRouter.mockReturnValue({
      push,
      replace,
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    mockUseSearchParams.mockReturnValue({
      get: jest.fn(() => null),
    });
    global.fetch = jest.fn();
  });

  it('ne redirige pas vers /login quand la session cookie est valide mais le hint local est absent', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO' } as never);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      createJsonResponse({ id: 'pro_1', businessName: 'Blob Pro', bio: 'Coach', photoUrl: null }, { ok: true })
    );

    render(<ProOnboardingPage />);

    expect(await screen.findByText(/Compléter mon profil professionnel/i)).toBeInTheDocument();
    expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('redirige vers /login uniquement après échec réel de session', async () => {
    mockedApiClient.me.mockRejectedValueOnce(Object.assign(new Error('Session expirée'), { code: 'SESSION_EXPIRED' }));

    render(<ProOnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('redirige un rider connecté vers /onboarding sans boucle triviale vers /login', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<ProOnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/onboarding');
    });
    expect(replace).not.toHaveBeenCalledWith('/login');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('garde le pro sur la checklist quand le profil reste incomplet malgré une session valide', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO' } as never);
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      createJsonResponse({ id: 'pro_2', businessName: 'Blob Pro', bio: '', photoUrl: null }, { ok: true })
    );

    render(<ProOnboardingPage />);

    expect(await screen.findByText(/Photo de profil ou logo/i)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalledWith('/login');
    expect(replace).not.toHaveBeenCalledWith('/pro/dashboard');
  });
});
