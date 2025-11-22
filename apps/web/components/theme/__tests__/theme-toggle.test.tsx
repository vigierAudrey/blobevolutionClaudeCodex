import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../ThemeProvider';
import { ThemeToggle } from '../ThemeToggle';

describe('ThemeToggle', () => {
  it('bascule la classe .dark sur <html>', () => {
    // Ensure starting state
    document.documentElement.classList.remove('dark');

    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    const button = screen.getByRole('button', { name: /mode sombre|mode clair/i });
    // Click to toggle
    fireEvent.click(button);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // Click again -> back to light
    fireEvent.click(button);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

