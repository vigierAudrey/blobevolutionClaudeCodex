import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BackBar } from '../BackBar';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

const mockUseRouter = useRouter as jest.Mock;

describe('BackBar', () => {
  const mockBack = jest.fn();
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue({
      back: mockBack,
      push: mockPush,
    });
    window.history.replaceState({ idx: 0 }, '', window.location.href);
  });

  it('navigue en arrière lorsqu’une entrée Next existe dans l’historique', async () => {
    window.history.replaceState({ idx: 2 }, '', window.location.href);
    const user = userEvent.setup();

    render(<BackBar fallbackHref="/fallback" />);
    await user.click(screen.getByRole('button', { name: /retour/i }));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('utilise la route de secours lorsque aucun historique Next n’est disponible', async () => {
    window.history.replaceState({ idx: 0 }, '', window.location.href);
    const user = userEvent.setup();

    render(<BackBar fallbackHref="/fallback" />);
    await user.click(screen.getByRole('button', { name: /retour/i }));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/fallback');
  });
});
