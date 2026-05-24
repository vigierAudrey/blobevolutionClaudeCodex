import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ContactRequests } from '../ContactRequests';

jest.mock('../../lib/apiClient', () => ({
  apiClient: {
    getPendingContactRequests: jest.fn(),
    respondToContactRequest: jest.fn(),
  },
}));

import { apiClient } from '../../lib/apiClient';

const mockGet = apiClient.getPendingContactRequests as jest.Mock;
const mockRespond = apiClient.respondToContactRequest as jest.Mock;

const REQ_1 = {
  id: 'req-1',
  message: 'Bonjour, je souhaite vous proposer un cours de surf.',
  createdAt: '2026-05-24T10:00:00.000Z',
  conversationId: 'conv-1',
  proName: 'Surf School Pro',
};

const REQ_2 = {
  id: 'req-2',
  message: null,
  createdAt: '2026-05-24T11:00:00.000Z',
  conversationId: 'conv-2',
  proName: 'Professionnel',
};

beforeEach(() => {
  jest.useFakeTimers();
  mockGet.mockReset();
  mockRespond.mockReset();
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('ContactRequests — rendering', () => {
  it('renders nothing when no pending requests', async () => {
    mockGet.mockResolvedValue({ requests: [] });
    const { container } = render(<ContactRequests />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a request with pro name and message', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByText(/Surf School Pro/)).toBeInTheDocument());
    expect(screen.getByText(/Bonjour, je souhaite vous proposer un cours de surf/)).toBeInTheDocument();
  });

  it('renders "Professionnel" when proProfile is null', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_2] });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByText(/Professionnel/)).toBeInTheDocument());
  });

  it('renders Accept and Reject buttons for each request', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());
    expect(screen.getByTestId('reject-req-1')).toBeInTheDocument();
  });
});

// ─── Accept flow ──────────────────────────────────────────────────────────────

describe('ContactRequests — accept flow', () => {
  it('disables buttons while request is in flight', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    let resolveRespond!: (v: unknown) => void;
    mockRespond.mockReturnValue(new Promise(r => { resolveRespond = r; }));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeDisabled());
    expect(screen.getByTestId('reject-req-1')).toBeDisabled();

    resolveRespond({ success: true, status: 'ACCEPTED', message: 'Accepté' });
    // done state: buttons replaced by status label
    await waitFor(() => expect(screen.queryByTestId('accept-req-1')).not.toBeInTheDocument());
  });

  it('removes request from list after ACCEPTED', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockResolvedValue({ success: true, status: 'ACCEPTED', message: 'Le professionnel a été ajouté à votre conversation' });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByText(/Accepté/)).toBeInTheDocument());

    jest.advanceTimersByTime(3000);
    await waitFor(() => expect(screen.queryByTestId('contact-request-req-1')).not.toBeInTheDocument());
  });

  it('removes request from list after REJECTED', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockResolvedValue({ success: true, status: 'REJECTED', message: 'Demande refusée' });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('reject-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('reject-req-1'));
    await waitFor(() => expect(screen.getByText(/Refusé/)).toBeInTheDocument());

    jest.advanceTimersByTime(3000);
    await waitFor(() => expect(screen.queryByTestId('contact-request-req-1')).not.toBeInTheDocument());
  });

  it('shows PENDING label when not all riders responded', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockResolvedValue({ success: true, status: 'PENDING', message: 'En attente des autres participants' });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByText(/Enregistré/)).toBeInTheDocument());
  });

  it('calls respondToContactRequest with correct contactRequestId and ACCEPT', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockResolvedValue({ success: true, status: 'ACCEPTED', message: 'ok' });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(mockRespond).toHaveBeenCalledWith('req-1', 'ACCEPT'));
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('ContactRequests — error handling', () => {
  function makeApiError(body: { error: string; message?: string }, status: number) {
    const err = new Error(body.message ?? body.error) as Error & { status: number; body: { error: string } };
    err.status = status;
    err.body = body;
    return err;
  }

  it('silently removes request on ALREADY_RESPONDED (permanent)', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockRejectedValue(makeApiError({ error: 'ALREADY_RESPONDED', message: 'You have already responded' }, 409));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.queryByTestId('contact-request-req-1')).not.toBeInTheDocument());
  });

  it('silently removes request on CONTACT_REQUEST_ALREADY_RESOLVED (permanent)', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockRejectedValue(makeApiError({ error: 'CONTACT_REQUEST_ALREADY_RESOLVED' }, 409));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.queryByTestId('contact-request-req-1')).not.toBeInTheDocument());
  });

  it('shows retryable error message on CONCURRENT_UPDATE', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockRejectedValue(makeApiError({ error: 'CONCURRENT_UPDATE', message: 'Please retry' }, 409));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByText(/Conflit temporaire/)).toBeInTheDocument());

    expect(screen.getByText(/Réessayer/)).toBeInTheDocument();
    expect(screen.getByTestId('contact-request-req-1')).toBeInTheDocument();
  });

  it('allows retry after CONCURRENT_UPDATE via Réessayer link', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond
      .mockRejectedValueOnce(makeApiError({ error: 'CONCURRENT_UPDATE', message: 'Please retry' }, 409))
      .mockResolvedValueOnce({ success: true, status: 'ACCEPTED', message: 'ok' });

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByText('Réessayer')).toBeInTheDocument());

    await user.click(screen.getByText('Réessayer'));
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).not.toBeDisabled());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByText(/Accepté/)).toBeInTheDocument());

    expect(mockRespond).toHaveBeenCalledTimes(2);
  });

  it('shows calm rate limit message on 429', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    mockRespond.mockRejectedValue(makeApiError({ error: 'CONTACT_RESPOND_RATE_LIMIT_EXCEEDED', message: 'Too many responses' }, 429));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByText(/Trop de réponses/)).toBeInTheDocument());

    expect(screen.queryByText('Réessayer')).not.toBeInTheDocument();
    expect(screen.getByTestId('contact-request-req-1')).toBeInTheDocument();
  });

  it('does not trigger double-click when already loading', async () => {
    mockGet.mockResolvedValue({ requests: [REQ_1] });
    let resolveRespond!: (v: unknown) => void;
    mockRespond.mockReturnValue(new Promise(r => { resolveRespond = r; }));

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ContactRequests />);
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('accept-req-1'));
    await waitFor(() => expect(screen.getByTestId('accept-req-1')).toBeDisabled());

    // Both buttons disabled — clicks should be no-ops
    await user.click(screen.getByTestId('accept-req-1'));
    await user.click(screen.getByTestId('reject-req-1'));

    expect(mockRespond).toHaveBeenCalledTimes(1);

    resolveRespond({ success: true, status: 'ACCEPTED', message: 'ok' });
    await waitFor(() => expect(screen.getByText(/Accepté/)).toBeInTheDocument());
  });
});
