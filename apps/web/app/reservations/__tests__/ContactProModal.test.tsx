import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ContactProModal } from '../start/ContactProModal';

jest.mock('../../../lib/apiClient', () => ({
  apiClient: {
    openConversation: jest.fn(),
    sendMessage: jest.fn(),
  },
}));

const apiClient = require('../../../lib/apiClient').apiClient as jest.Mocked<typeof import('../../../lib/apiClient').apiClient>;

const pro = {
  proId: 'pro-123',
  email: 'pro@test.com',
  businessName: 'Coach Test',
  photoUrl: null,
  verified: true,
  lat: 0,
  lng: 0,
  distanceKm: 1,
  sports: [],
  openAvailabilityCount: 0,
};

describe('ContactProModal', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    apiClient.openConversation.mockReset();
    apiClient.sendMessage.mockReset();
    window.localStorage.clear();
  });

  it('shows cooldown message and disables button on 429', async () => {
    apiClient.openConversation.mockRejectedValueOnce({ status: 429, body: { message: 'Merci, message déjà envoyé récemment. Réessaie dans quelques instants.' } });

    render(<ContactProModal pro={pro} onClose={() => {}} onSubmitted={() => {}} />);

    const textarea = screen.getByPlaceholderText(/Présente-toi/i);
    await userEvent.type(textarea, 'Hello!');
    await userEvent.click(screen.getByRole('button', { name: /Envoyer le message/i }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClient.openConversation).toHaveBeenCalled();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Merci, message déjà envoyé récemment. Réessaie dans quelques instants.');

    const button = screen.getByRole('button', { name: /Réessayer dans/i });
    expect(button).toBeDisabled();

    expect(screen.getByRole('button', { name: /Réessayer dans/i })).toBeDisabled();
  });

  it('uses retryAfterSeconds from API and re-enables after countdown', async () => {
    apiClient.openConversation.mockRejectedValueOnce({
      status: 429,
      body: { message: 'cooldown', retryAfterSeconds: 1 },
    });

    render(<ContactProModal pro={pro} onClose={() => {}} onSubmitted={() => {}} />);

    await userEvent.type(screen.getByPlaceholderText(/Présente-toi/i), 'Hello!');
    await userEvent.click(screen.getByRole('button', { name: /Envoyer le message/i }));

    await act(async () => {
      await Promise.resolve();
    });

    const alert = await screen.findByRole('alert');
    expect(apiClient.openConversation).toHaveBeenCalled();
    expect(alert).toHaveTextContent(/cooldown/i);

    const button = screen.getByRole('button', { name: /Réessayer dans/i });
    expect(button).toBeDisabled();

    const stored = window.localStorage.getItem('blob:contactCooldown:local:pro-123');
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThan(Date.now());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    });

    const sendButton = screen.getByRole('button', { name: /Envoyer le message/i });
    expect(sendButton).not.toBeDisabled();
    expect(window.localStorage.getItem('blob:contactCooldown:local:pro-123')).toBeNull();
  });

  it('restores cooldown from localStorage when reopening the modal', async () => {
    jest.useFakeTimers();
    const expiresAt = Date.now() + 10_000;
    window.localStorage.setItem('blob:contactCooldown:local:pro-123', expiresAt.toString());

    render(<ContactProModal pro={pro} onClose={() => {}} onSubmitted={() => {}} />);

    const button = await screen.findByRole('button', { name: /Réessayer dans/i });
    expect(button).toBeDisabled();

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });

    const sendButton = screen.getByRole('button', { name: /Envoyer le message/i });
    expect(sendButton).not.toBeDisabled();
    expect(window.localStorage.getItem('blob:contactCooldown:local:pro-123')).toBeNull();
  });
});
