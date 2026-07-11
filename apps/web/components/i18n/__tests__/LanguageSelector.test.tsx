import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import fr from '@/messages/fr.json';
import { LanguageSelector } from '../LanguageSelector';
import { hardReload } from '@/lib/hardReload';

jest.mock('@/lib/hardReload', () => ({ hardReload: jest.fn() }));

const hardReloadMock = hardReload as jest.MockedFunction<typeof hardReload>;

function renderSelector(locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={fr} timeZone="Europe/Paris">
      <LanguageSelector />
    </NextIntlClientProvider>,
  );
}

function clearLocaleCookie() {
  document.cookie = 'NEXT_LOCALE=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

describe('LanguageSelector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearLocaleCookie();
  });

  it('affiche la langue courante issue du provider', () => {
    renderSelector();
    expect(screen.getByRole('button', { name: /choisir la langue/i })).toHaveTextContent(
      'Français',
    );
  });

  it('ouvre le menu et liste les 5 langues', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /choisir la langue/i }));

    for (const label of ['Français', 'English', 'Español', 'Deutsch', 'Nederlands']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('écrit le cookie NEXT_LOCALE et recharge la page au changement de langue', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /choisir la langue/i }));
    fireEvent.click(screen.getByRole('button', { name: /english/i }));

    expect(document.cookie).toContain('NEXT_LOCALE=en');
    expect(hardReloadMock).toHaveBeenCalledTimes(1);
  });

  it('ne recharge pas quand on re-sélectionne la langue courante', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /choisir la langue/i }));

    const currentOption = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Français') && button !== screen.getAllByRole('button')[0]);
    expect(currentOption).toBeDisabled();

    expect(document.cookie).not.toContain('NEXT_LOCALE=');
    expect(hardReloadMock).not.toHaveBeenCalled();
  });
});
