import { fireEvent, render, screen } from '@testing-library/react';

import { AccessibilityProvider, useAccessibility } from '../AccessibilityProvider';

function TestConsumer() {
  const { preferences, togglePreference, resetPreferences } = useAccessibility();
  return (
    <div>
      <span data-testid="status">{preferences.highContrast ? 'on' : 'off'}</span>
      <button type="button" onClick={() => togglePreference('highContrast')}>
        toggle
      </button>
      <button type="button" onClick={resetPreferences}>
        reset
      </button>
    </div>
  );
}

describe('AccessibilityProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.className = '';
    document.documentElement.className = '';
    delete document.documentElement.dataset.reduceMotion;
  });

  it('applique les classes DOM quand les préférences changent', () => {
    render(
      <AccessibilityProvider>
        <TestConsumer />
      </AccessibilityProvider>,
    );

    expect(screen.getByTestId('status').textContent).toBe('off');
    fireEvent.click(screen.getByText('toggle'));

    expect(screen.getByTestId('status').textContent).toBe('on');
    expect(document.body.classList.contains('accessibility-high-contrast')).toBe(true);
  });

  it('réinitialise les préférences et nettoie les classes', () => {
    render(
      <AccessibilityProvider>
        <TestConsumer />
      </AccessibilityProvider>,
    );

    fireEvent.click(screen.getByText('toggle'));
    fireEvent.click(screen.getByText('reset'));

    expect(document.body.classList.contains('accessibility-high-contrast')).toBe(false);
    expect(screen.getByTestId('status').textContent).toBe('off');
  });
});
