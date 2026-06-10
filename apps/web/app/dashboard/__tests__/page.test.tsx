/**
 * Tests pour DashboardPage (RIDER).
 *
 * Invariants vérifiés :
 *   1. RIDER + profil incomplet → redirect /onboarding sans afficher le dashboard
 *   2. RIDER + profil complet   → dashboard affiché (pas de redirect)
 *   3. PRO role                 → redirect /pro/dashboard sans afficher le dashboard
 *   4. Session expirée          → redirect /login
 *   5. Profil check avant setLoading(false) : loader visible pendant redirect (pas de flash)
 *   6. Pas de double router.replace (une seule direction de sortie par cas)
 *   7. Pas de localStorage comme source de vérité pour auth/profil
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(() => '/dashboard'),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getTokens: jest.fn(),
    getProfile: jest.fn(),
    getDisciplines: jest.fn(),
    listAllConversations: jest.fn(),
    logoutAll: jest.fn(),
    clearTokens: jest.fn(),
    saveTokens: jest.fn(),
  },
}));

jest.mock('@/lib/clientSession', () => jest.requireActual('@/lib/clientSession'));

// Mock composants lourds qui ont des dépendances externes
jest.mock('@/components/blob', () => ({
  BlobAlert: ({ children }: { children: React.ReactNode }) => <div data-testid="blob-alert">{children}</div>,
  BlobBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  BlobButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  BlobCard: ({ children }: { children: React.ReactNode }) => <div data-testid="blob-card">{children}</div>,
  BlobDashboardShell: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div data-testid="dashboard-shell">
      <h1>{title}</h1>
      {children}
    </div>
  ),
  BlobMark: () => <span data-testid="blob-mark" />,
}));

jest.mock('@/components/NotificationBell', () => ({
  NotificationBell: () => <span data-testid="notification-bell" />,
}));

jest.mock('@/components/community/CommunityHighlight', () => ({
  CommunityHighlight: () => <div data-testid="community-highlight" />,
}));

import DashboardPage from '../page';

const mockUseRouter = useRouter as jest.Mock;
const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const incompleteProfile = { displayName: null, hasPhoto: false };
const completeProfile = { displayName: 'Audrey', hasPhoto: true };
const completeDisciplines = [{ sport: 'SURF', level: 'INTERMEDIATE' }];

describe('DashboardPage — auth guard et profile check', () => {
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
    // listAllConversations utilisé pour le polling unread — silencieux par défaut
    mockedApiClient.listAllConversations.mockResolvedValue({ items: [] } as never);
  });

  describe('redirect silencieux (pas de flash dashboard)', () => {
    it('RIDER + profil incomplet → redirect /onboarding sans afficher le contenu dashboard', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce(incompleteProfile as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce([]);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/onboarding');
      });

      // Le dashboard-shell ne doit PAS être rendu
      expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
    });

    it('RIDER + 1 critère manquant (photo absente) → redirect /onboarding', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce({ displayName: 'Audrey', hasPhoto: false } as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce(completeDisciplines as never);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/onboarding');
      });
      expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
    });

    it('RIDER + 1 critère manquant (discipline absente) → redirect /onboarding', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce(completeProfile as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce([]);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/onboarding');
      });
      expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
    });

    it('PRO role → redirect /pro/dashboard sans afficher le dashboard RIDER', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'PRO', id: 'u2', emailVerified: true } as never);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/pro/dashboard');
      });
      expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
      // getProfile ne doit pas être appelé pour les PRO — redirect immédiat
      expect(mockedApiClient.getProfile).not.toHaveBeenCalled();
    });

    it('ADMIN role → redirect /admin/dashboard sans afficher le dashboard RIDER', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'ADMIN', id: 'u3', emailVerified: true } as never);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/admin/dashboard');
      });
      expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
      // getProfile ne doit pas être appelé pour les ADMIN — redirect immédiat
      expect(mockedApiClient.getProfile).not.toHaveBeenCalled();
    });

    it('session expirée → redirect /login', async () => {
      const err = Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' });
      mockedApiClient.me.mockRejectedValueOnce(err);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/login');
      });
      expect(screen.queryByTestId('dashboard-shell')).not.toBeInTheDocument();
    });
  });

  describe('affichage dashboard', () => {
    it('RIDER + profil complet → affiche le dashboard', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce(completeProfile as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce(completeDisciplines as never);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument();
      });

      expect(replace).not.toHaveBeenCalledWith('/onboarding');
      expect(replace).not.toHaveBeenCalledWith('/login');
    });

    it('RIDER + profil complet → displayName affiché dans le titre', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce(completeProfile as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce(completeDisciplines as never);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByText(/Salut Audrey/)).toBeInTheDocument();
      });
    });

    it('getProfile échoue → dashboard affiché quand même (dégradation gracieuse)', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockRejectedValueOnce(new Error('Network error'));
      mockedApiClient.getDisciplines.mockResolvedValueOnce([]);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument();
      });

      // Pas de redirect — le dashboard est affiché en dégradé
      expect(replace).not.toHaveBeenCalledWith('/onboarding');
    });
  });

  describe('absence de double redirect', () => {
    it('profil incomplet → exactement un seul replace(/onboarding)', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce(incompleteProfile as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce([]);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/onboarding');
      });

      expect(replace.mock.calls.filter((c) => c[0] === '/onboarding').length).toBe(1);
      expect(replace.mock.calls.filter((c) => c[0] === '/dashboard').length).toBe(0);
    });

    it('profil complet → aucun replace vers /onboarding ni /login', async () => {
      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce(completeProfile as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce(completeDisciplines as never);

      render(<DashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument();
      });

      expect(replace).not.toHaveBeenCalledWith('/onboarding');
      expect(replace).not.toHaveBeenCalledWith('/login');
      expect(replace.mock.calls.length).toBe(0);
    });
  });

  describe('localStorage non utilisé comme source de vérité', () => {
    it('localStorage arbitraire ne déclenche pas de redirect non autorisé', async () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('blob_onboarding_complete', '1');
        window.localStorage.setItem('blob_session_hint', '1');
      }

      mockedApiClient.me.mockResolvedValueOnce({ role: 'RIDER', id: 'u1', emailVerified: true } as never);
      mockedApiClient.getProfile.mockResolvedValueOnce(incompleteProfile as never);
      mockedApiClient.getDisciplines.mockResolvedValueOnce([]);

      render(<DashboardPage />);

      // Même avec localStorage rempli, le serveur décide : profil incomplet → onboarding
      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith('/onboarding');
      });

      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('blob_onboarding_complete');
        window.localStorage.removeItem('blob_session_hint');
      }
    });
  });
});
