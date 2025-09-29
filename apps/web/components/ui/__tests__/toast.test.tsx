import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider, Toaster, useToast } from '../toast';

describe('ToastProvider', () => {
  let counter = 0;

  beforeAll(() => {
    Object.defineProperty(global, 'crypto', {
      value: {
        randomUUID: jest.fn(() => `toast-id-${counter++}`),
      },
      configurable: true,
    });
  });

  beforeEach(() => {
    counter = 0;
    ((global.crypto as any).randomUUID as jest.Mock).mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('throws when useToast is called outside provider', () => {
    // Suppress console.error for this test since we expect an error
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const Consumer = () => {
      useToast();
      return null;
    };

    expect(() => render(<Consumer />)).toThrow('useToast must be used within ToastProvider');

    consoleError.mockRestore();
  });

  it('shows toast messages with styling based on type', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const Consumer = () => {
      const toast = useToast();
      return (
        <button onClick={() => toast('Saved!', 'success', 2000)}>
          Launch toast
        </button>
      );
    };

    render(
      <ToastProvider>
        <Consumer />
      </ToastProvider>,
    );

    await user.click(screen.getByText(/launch toast/i));

    await waitFor(() => {
      const toast = screen.getByRole('status');
      expect(toast).toHaveTextContent('Saved!');
      expect(toast).toHaveClass('bg-green-50');
    });
  });

  it('automatically dismisses toasts after timeout', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const Consumer = () => {
      const toast = useToast();
      return (
        <button onClick={() => toast('Bye', 'info', 1000)}>
          Toast once
        </button>
      );
    };

    render(
      <ToastProvider>
        <Consumer />
      </ToastProvider>,
    );

    await user.click(screen.getByText(/toast once/i));

    await waitFor(() => {
      expect(screen.getByText('Bye')).toBeInTheDocument();
    });

    await user.click(screen.getByText(/toast once/i));

    await waitFor(() => {
      expect(screen.getAllByText('Bye')).toHaveLength(2);
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.queryByText('Bye')).not.toBeInTheDocument();
    });
  });
});

describe('Toaster', () => {
  it('renders provided toast entries', () => {
    render(
      <Toaster
        toasts={[
          { id: '1', type: 'error', message: 'Failed', timeout: 1000 },
          { id: '2', type: 'info', message: 'Info', timeout: 3000 },
        ]}
      />,
    );

    expect(screen.getByText('Failed')).toHaveClass('bg-red-50');
    expect(screen.getByText('Info')).toBeInTheDocument();
  });
});
