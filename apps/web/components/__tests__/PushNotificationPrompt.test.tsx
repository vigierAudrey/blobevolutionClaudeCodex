import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import PushNotificationPrompt, { CompactPushPrompt, PushNotificationToggle } from '../PushNotificationPrompt';

jest.mock('../../hooks/usePushNotifications', () => {
  const hookMock = jest.fn();
  return {
    __esModule: true,
    usePushPermissionPrompt: hookMock,
    __mock: {
      hookMock,
    },
  };
});

const getHookMock = () =>
  (jest.requireMock('../../hooks/usePushNotifications') as any).__mock.hookMock as jest.Mock;

describe('PushNotificationPrompt', () => {
  beforeEach(() => {
    getHookMock().mockReset();
  });

  it('renders nothing when prompt is not visible', () => {
    getHookMock().mockReturnValue({
      isVisible: false,
      handleAccept: jest.fn(),
      handleDismiss: jest.fn(),
    });

    const { container } = render(<PushNotificationPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('animates into view when becoming visible', async () => {
    jest.useFakeTimers();
    const handlers = {
      handleAccept: jest.fn(),
      handleDismiss: jest.fn(),
    };
    getHookMock().mockReturnValue({
      isVisible: true,
      ...handlers,
    });

    render(<PushNotificationPrompt />);

    const heading = screen.getByRole('heading', { name: /activer les notifications/i });
    const promptRoot = heading.parentElement?.parentElement?.parentElement?.parentElement as HTMLElement;
    expect(promptRoot.className).toMatch(/opacity-0/);

    await act(async () => {
      jest.advanceTimersByTime(150);
    });

    expect(promptRoot.className).toMatch(/opacity-100/);

    jest.useRealTimers();
  });

  it('delegates accept and dismiss actions', async () => {
    const handlers = {
      handleAccept: jest.fn(),
      handleDismiss: jest.fn(),
    };
    getHookMock().mockReturnValue({
      isVisible: true,
      ...handlers,
    });
    const user = userEvent.setup();

    render(<PushNotificationPrompt />);

    await user.click(screen.getByRole('button', { name: /activer$/i }));
    expect(handlers.handleAccept).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /pas maintenant/i }));
    expect(handlers.handleDismiss).toHaveBeenCalledTimes(1);

    await act(async () => {
      await user.click(screen.getByLabelText(/fermer/i));
    });
    expect(handlers.handleDismiss).toHaveBeenCalledTimes(2);
  });
});

describe('CompactPushPrompt', () => {
  it('calls provided callbacks', async () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();
    const user = userEvent.setup();

    render(
      <CompactPushPrompt message="Enable push" onAccept={onAccept} onDismiss={onDismiss} />,
    );

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /activer/i }));
    });
    expect(onAccept).toHaveBeenCalledTimes(1);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /✕/i }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('PushNotificationToggle', () => {
  it('toggles enabled state', async () => {
    const user = userEvent.setup();

    render(<PushNotificationToggle />);

    const toggle = screen.getByRole('button', { hidden: true });
    expect(toggle.className).toMatch(/bg-gray-200/);

    await act(async () => {
      await user.click(toggle);
    });
    expect(toggle.className).toMatch(/bg-blue-600/);

    await act(async () => {
      await user.click(toggle);
    });
    expect(toggle.className).toMatch(/bg-gray-200/);
  });
});
