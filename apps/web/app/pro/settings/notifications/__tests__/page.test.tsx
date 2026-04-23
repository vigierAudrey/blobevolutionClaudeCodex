import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProNotificationsPage from '../page';
import { useRouter } from 'next/navigation';
import * as clientSession from '@/lib/clientSession';
import { apiRequest } from '@/lib/csrf';
import { useToast } from '@/components/ui/toast';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/lib/clientSession', () => ({
  requireClientRole: jest.fn(),
  RoleMismatchError: class RoleMismatchError extends Error {
    readonly code = 'ROLE_MISMATCH';
  },
  SessionRequiredError: class SessionRequiredError extends Error {
    readonly code = 'SESSION_REQUIRED';
  },
}));

jest.mock('@/lib/csrf', () => ({
  apiRequest: jest.fn(),
}));

jest.mock('@/components/ui/toast', () => ({
  useToast: jest.fn(),
}));

jest.mock('@/components/BackBar', () => ({
  BackBar: () => <div data-testid="backbar" />,
}));

jest.mock('@/components/ui/spinner', () => ({
  Spinner: () => <span data-testid="spinner" />,
}));

const mockUseRouter = useRouter as jest.Mock;
const mockRequireClientRole = clientSession.requireClientRole as jest.Mock;
const mockApiRequest = apiRequest as jest.Mock;
const mockUseToast = useToast as jest.Mock;

const makeResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
});

const PRO_PREFS_RESPONSE = {
  role: 'PRO',
  preferences: {
    pushEnabled: false,
    notifyLessonRequests: true,
    notifyProMessages: false,
    notifyForSurf: true,
    notifyForKitesurf: false,
    // champs fantomes — NE doivent PAS contaminer le state ni le payload PUT
    notifyBookingAccepted: true,
    notifyBookingRejected: true,
    emailEnabled: true,
    emailDigestFrequency: 'DAILY',
  },
};

describe('ProNotificationsPage', () => {
  const replace = jest.fn();
  const toastFn = jest.fn();

  beforeEach(() => {
    // resetAllMocks vide les queues mockOnce ET les implementations
    // => on re-initialise explicitement ce qui doit avoir une valeur
    jest.resetAllMocks();
    mockUseToast.mockReturnValue(toastFn);
    mockUseRouter.mockReturnValue({
      replace,
      push: jest.fn(),
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────

  it('redirige vers /login si session absente (SessionRequiredError)', async () => {
    const { SessionRequiredError } = jest.requireMock('@/lib/clientSession');
    mockRequireClientRole.mockRejectedValueOnce(new SessionRequiredError());

    render(<ProNotificationsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login');
    });
  });

  it('redirige vers /dashboard si le role est RIDER (RoleMismatchError)', async () => {
    const { RoleMismatchError } = jest.requireMock('@/lib/clientSession');
    mockRequireClientRole.mockRejectedValueOnce(new RoleMismatchError());

    render(<ProNotificationsPage />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/dashboard');
    });
  });

  // ── Chargement des preferences ─────────────────────────────────────────────

  it('charge et applique les preferences depuis l\'API', async () => {
    mockRequireClientRole.mockResolvedValueOnce({ role: 'PRO' });
    mockApiRequest.mockResolvedValueOnce(makeResponse(PRO_PREFS_RESPONSE));

    render(<ProNotificationsPage />);

    // pushEnabled = false => info box visible
    await waitFor(() => {
      expect(screen.getByText(/notifications désactivées/i)).toBeInTheDocument();
    });

    // Les toggles PRO sont bien rendus
    expect(screen.getByRole('button', { name: /toggle lesson request notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /toggle surf notifications/i })).toBeInTheDocument();
  });

  it('n\'injecte pas les champs fantomes dans le state (D2-FIX)', async () => {
    mockRequireClientRole.mockResolvedValueOnce({ role: 'PRO' });
    mockApiRequest
      .mockResolvedValueOnce(makeResponse(PRO_PREFS_RESPONSE))  // GET
      .mockResolvedValueOnce(makeResponse({ success: true }));   // PUT

    render(<ProNotificationsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sauvegarder/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /sauvegarder/i }));

    await waitFor(() => {
      const putCall = mockApiRequest.mock.calls.find((c) => c[1]?.method === 'PUT');
      expect(putCall).toBeDefined();
      const payload = JSON.parse(putCall![1].body as string);

      // Champs fantomes absents du payload
      expect(payload).not.toHaveProperty('notifyBookingAccepted');
      expect(payload).not.toHaveProperty('notifyBookingRejected');
      expect(payload).not.toHaveProperty('emailEnabled');
      expect(payload).not.toHaveProperty('emailDigestFrequency');

      // Exactement les 5 cles booleennes de l'UI
      expect(Object.keys(payload).sort()).toEqual([
        'notifyForKitesurf',
        'notifyForSurf',
        'notifyLessonRequests',
        'notifyProMessages',
        'pushEnabled',
      ]);
    });
  });

  // ── Erreur de chargement ────────────────────────────────────────────────────

  it('affiche un message d\'erreur si GET retourne 401 — pas de bouton sauvegarder (D3-FIX)', async () => {
    mockRequireClientRole.mockResolvedValueOnce({ role: 'PRO' });
    mockApiRequest.mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, 401));

    render(<ProNotificationsPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/impossible de charger/i);
    expect(screen.queryByRole('button', { name: /sauvegarder/i })).not.toBeInTheDocument();
  });

  it('affiche un message d\'erreur si GET retourne 500 (D3-FIX)', async () => {
    mockRequireClientRole.mockResolvedValueOnce({ role: 'PRO' });
    mockApiRequest.mockResolvedValueOnce(makeResponse({ error: 'Internal Server Error' }, 500));

    render(<ProNotificationsPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/impossible de charger/i);
  });

  it('affiche un message d\'erreur si le reseau est coupe (D3-FIX)', async () => {
    mockRequireClientRole.mockResolvedValueOnce({ role: 'PRO' });
    mockApiRequest.mockRejectedValueOnce(new Error('Network error'));

    render(<ProNotificationsPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/impossible de charger/i);
  });

  // ── Sauvegarde ──────────────────────────────────────────────────────────────

  it('envoie PUT /profile/notifications avec le bon payload', async () => {
    mockRequireClientRole.mockResolvedValueOnce({ role: 'PRO' });
    mockApiRequest
      .mockResolvedValueOnce(makeResponse(PRO_PREFS_RESPONSE))  // GET
      .mockResolvedValueOnce(makeResponse({ success: true }));   // PUT

    render(<ProNotificationsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sauvegarder/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /sauvegarder/i }));

    await waitFor(() => {
      const putCall = mockApiRequest.mock.calls.find((c) => c[1]?.method === 'PUT');
      expect(putCall).toBeDefined();
      const payload = JSON.parse(putCall![1].body as string);
      // Valeurs issues de l'API
      expect(payload.pushEnabled).toBe(false);
      expect(payload.notifyProMessages).toBe(false);
      expect(payload.notifyLessonRequests).toBe(true);
    });
  });
});
