import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiClient } from '@/lib/apiClient';
import AdminUsers from '../page';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    me: jest.fn(),
    getAdminUsers: jest.fn(),
    verifyPro: jest.fn(),
    suspendUser: jest.fn(),
    requestAdminStepUp: jest.fn(),
    verifyAdminStepUp: jest.fn(),
  },
  isAdminStepUpRequiredError: (error: unknown) => {
    const apiError = error as { status?: number; body?: { error?: unknown }; message?: unknown } | null;
    return (
      apiError?.status === 403 &&
      (apiError.body?.error === 'Step-up authentication required' || apiError.message === 'Step-up authentication required')
    );
  },
  getApiRetryAfterSeconds: (error: unknown) => {
    const apiError = error as {
      retryAfterSeconds?: unknown;
      body?: { retryAfterSeconds?: unknown; retryAfter?: unknown };
    } | null;
    const raw = apiError?.retryAfterSeconds ?? apiError?.body?.retryAfterSeconds ?? apiError?.body?.retryAfter;
    const numeric = typeof raw === 'string' ? Number(raw) : raw;
    return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0
      ? Math.ceil(numeric)
      : undefined;
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

const proUser = {
  id: 'pro-1',
  email: 'pro@example.com',
  role: 'PRO' as const,
  emailVerified: false,
  createdAt: '2026-06-01T10:00:00.000Z',
  deletedAt: null,
  proProfile: {
    businessName: 'Blob Pro',
    verified: false,
  },
};

describe('AdminUsers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiClient.me.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' } as never);
    mockedApiClient.getAdminUsers.mockResolvedValue({
      users: [proUser],
      pagination: { totalPages: 1 },
    } as never);
    mockedApiClient.requestAdminStepUp.mockResolvedValue({ message: 'Code envoyé' } as never);
    mockedApiClient.verifyAdminStepUp.mockResolvedValue({
      message: 'Admin step-up granted',
      stepUpUntil: Date.now() + 300000,
    } as never);
  });

  it('clarifie validation pro et email vérifié séparément', async () => {
    render(<AdminUsers />);

    expect(await screen.findByText('Blob Pro')).toBeInTheDocument();
    expect(screen.getByText('Email non vérifié')).toBeInTheDocument();
    expect(screen.getByText('Valider profil pro')).toBeInTheDocument();
    expect(screen.getByText(/La validation pro est une validation manuelle/)).toBeInTheDocument();
  });

  it('affiche la step-up admin puis rejoue la validation pro après 2FA', async () => {
    const user = userEvent.setup();
    const stepUpError = Object.assign(new Error('Step-up authentication required'), {
      status: 403,
      body: { error: 'Step-up authentication required' },
    });

    mockedApiClient.verifyPro
      .mockRejectedValueOnce(stepUpError)
      .mockResolvedValueOnce({ verified: true } as never);

    render(<AdminUsers />);

    await user.click(await screen.findByRole('button', { name: /valider profil pro/i }));

    expect(await screen.findByText('Confirmation admin requise pour valider ce profil pro.')).toBeInTheDocument();
    expect(screen.queryByText(/^Step-up authentication required$/)).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Confirmation admin requise' })).toBeInTheDocument();
    expect(mockedApiClient.requestAdminStepUp).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('Code 2FA admin'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => {
      expect(mockedApiClient.verifyAdminStepUp).toHaveBeenCalledWith('123456');
      expect(mockedApiClient.verifyPro).toHaveBeenCalledTimes(2);
    });
    expect(mockedApiClient.verifyPro).toHaveBeenNthCalledWith(1, 'pro-1', true);
    expect(mockedApiClient.verifyPro).toHaveBeenNthCalledWith(2, 'pro-1', true);
  });

  it('ouvre la modale avec un seul envoi automatique en StrictMode', async () => {
    const user = userEvent.setup();
    const stepUpError = Object.assign(new Error('Step-up authentication required'), {
      status: 403,
      body: { error: 'Step-up authentication required' },
    });

    mockedApiClient.verifyPro.mockRejectedValueOnce(stepUpError);

    render(
      <React.StrictMode>
        <AdminUsers />
      </React.StrictMode>,
    );

    await user.click(await screen.findByRole('button', { name: /valider profil pro/i }));

    expect(await screen.findByRole('heading', { name: 'Confirmation admin requise' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedApiClient.requestAdminStepUp).toHaveBeenCalledTimes(1);
    });
  });

  it('affiche un cooldown humain sur 429 et désactive le renvoi', async () => {
    const user = userEvent.setup();
    const stepUpError = Object.assign(new Error('Step-up authentication required'), {
      status: 403,
      body: { error: 'Step-up authentication required' },
    });
    const rateLimitError = Object.assign(new Error('AUTH_RATE_LIMIT_EXCEEDED'), {
      status: 429,
      retryAfterSeconds: 30,
      body: { error: 'AUTH_RATE_LIMIT_EXCEEDED', retryAfterSeconds: '30' },
    });

    mockedApiClient.verifyPro.mockRejectedValueOnce(stepUpError);
    mockedApiClient.requestAdminStepUp.mockRejectedValueOnce(rateLimitError);

    render(<AdminUsers />);

    await user.click(await screen.findByRole('button', { name: /valider profil pro/i }));

    expect(await screen.findByText('Trop de tentatives. Réessaie dans 30 secondes.')).toBeInTheDocument();
    expect(screen.queryByText('AUTH_RATE_LIMIT_EXCEEDED')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /renvoyer \(30s\)/i })).toBeDisabled();
  });

  it('ne confirme pas la step-up avec un code incomplet', async () => {
    const user = userEvent.setup();
    const stepUpError = Object.assign(new Error('Step-up authentication required'), {
      status: 403,
      body: { error: 'Step-up authentication required' },
    });

    mockedApiClient.verifyPro.mockRejectedValueOnce(stepUpError);

    render(<AdminUsers />);

    await user.click(await screen.findByRole('button', { name: /valider profil pro/i }));
    await screen.findByRole('heading', { name: 'Confirmation admin requise' });
    await user.type(screen.getByLabelText('Code 2FA admin'), '123');

    expect(screen.getByRole('button', { name: 'Confirmer' })).toBeDisabled();
    expect(mockedApiClient.verifyAdminStepUp).not.toHaveBeenCalled();
  });

  it('remplace le refus géolocalisation par un message métier court', async () => {
    const user = userEvent.setup();
    const locationError = Object.assign(new Error('La géolocalisation est requise pour rendre un profil pro visible.'), {
      status: 400,
      body: {
        error: 'Missing pro location',
        message: 'La géolocalisation est requise pour rendre un profil pro visible.',
      },
    });
    mockedApiClient.verifyPro.mockRejectedValueOnce(locationError);

    render(<AdminUsers />);

    await user.click(await screen.findByRole('button', { name: /valider profil pro/i }));

    expect(await screen.findByText('Profil pro incomplet — géolocalisation requise')).toBeInTheDocument();
  });
});
