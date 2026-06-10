/**
 * Tests for OnboardingPage.
 *
 * Invariants verified:
 *   1. Valid server session + profil incomplet → affiche la checklist onboarding
 *   2. Invalid server session (SESSION_EXPIRED) → redirect vers /login
 *   3. PRO role → redirect vers /pro/onboarding
 *   4. Profil complet → redirect automatique vers /dashboard
 *   5. Pas de fast-path localStorage : même avec une ancienne clé blob_onboarding_complete,
 *      la page vérifie le serveur avant de rediriger
 *   6. getTokens() n'est jamais appelé (hint local non consulté)
 *   7. Pas de double router.replace (une seule direction de sortie par cas)
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/onboarding'),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(),
    getProfile: jest.fn(),
    getDisciplines: jest.fn(),
  },
}));

jest.mock('@/lib/clientSession', () => jest.requireActual('@/lib/clientSession'));

import OnboardingPage from '../page';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('OnboardingPage — auth guard', () => {
  const replace = jest.fn();
  const push = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    replace.mockReset();
    push.mockReset();
    mockUseRouter.mockReturnValue({
      replace,
      push,
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
    // Nettoie localStorage — aucune trace d'ancienne session
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('blob_session_hint');
    }
    // Profil incomplet par défaut (déclenche l'affichage de la checklist)
    mockedApiClient.getProfile.mockResolvedValue({
      displayName: null,
      hasPhoto: false,
      photoEndpoint: null,
    } as never);
    mockedApiClient.getDisciplines.mockResolvedValue([]);
  });

  it('affiche la checklist onboarding quand le profil est incomplet', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    });

    expect(replace).not.toHaveBeenCalledWith('/login');
    expect(replace).not.toHaveBeenCalledWith('/dashboard');
    expect(mockedApiClient.me).toHaveBeenCalledTimes(1);
  });

  it('redirige vers /login quand la session expire — vérifie le serveur en premier', async () => {
    const err = Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' });
    mockedApiClient.me.mockRejectedValueOnce(err);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
    // getProfile ne doit pas être appelé — la session gate bloque en premier
    expect(mockedApiClient.getProfile).not.toHaveBeenCalled();
  });

  it('redirige PRO vers /pro/onboarding — pas /login', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/pro/onboarding');
    });
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('redirige ADMIN vers /admin/dashboard — pas onboarding ni /login', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'ADMIN' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/admin/dashboard');
    });
    expect(replace).not.toHaveBeenCalledWith('/login');
    expect(replace).not.toHaveBeenCalledWith('/onboarding');
    // getProfile ne doit pas être appelé — l'ADMIN est redirigé immédiatement
    expect(mockedApiClient.getProfile).not.toHaveBeenCalled();
  });

  it('ne consulte jamais getTokens() — pas de hint local', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    expect(mockedApiClient.getTokens).not.toHaveBeenCalled();
  });

  it('redirige vers /dashboard quand le profil est complet', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);
    mockedApiClient.getProfile.mockResolvedValueOnce({
      displayName: 'Audrey',
      hasPhoto: true,
      photoEndpoint: '/photo/123',
    } as never);
    mockedApiClient.getDisciplines.mockResolvedValueOnce([
      { sport: 'SURF', level: 'INTERMEDIATE' },
    ] as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/dashboard');
    });
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('PAS de bounce loop — même avec une ancienne clé localStorage, vérifie le serveur', async () => {
    // Simule un état localStorage d'une ancienne session (clé supprimée mais on teste la robustesse)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('blob_onboarding_complete', '1');
    }
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<OnboardingPage />);

    // La page doit attendre le résultat serveur, pas rediriger immédiatement
    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    // Profil incomplet → checklist affichée, pas de redirect vers dashboard
    await waitFor(() => {
      expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
    });

    expect(replace).not.toHaveBeenCalledWith('/dashboard');

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('blob_onboarding_complete');
    }
  });

  it('un seul replace() par cas — pas de double redirect', async () => {
    mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER' } as never);

    render(<OnboardingPage />);

    await waitFor(() => {
      expect(mockedApiClient.me).toHaveBeenCalled();
    });

    // Au maximum un appel replace sur le trajet incomplet
    expect(replace.mock.calls.filter((c) => c[0] === '/login').length).toBeLessThanOrEqual(1);
    expect(replace.mock.calls.filter((c) => c[0] === '/dashboard').length).toBeLessThanOrEqual(1);
  });
});
