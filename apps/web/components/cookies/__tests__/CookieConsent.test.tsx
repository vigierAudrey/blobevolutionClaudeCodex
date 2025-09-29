import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CookieConsent, useCookieConsent } from '../CookieConsent';

// Mock environment variables
const originalEnv = process.env;

// Spy on localStorage methods
let getItemSpy: jest.SpyInstance;
let setItemSpy: jest.SpyInstance;
let removeItemSpy: jest.SpyInstance;

describe('CookieConsent', () => {
  beforeEach(() => {
    // Setup localStorage spies
    Storage.prototype.getItem = jest.fn(() => null);
    Storage.prototype.setItem = jest.fn();
    Storage.prototype.removeItem = jest.fn();

    getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');

    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ADSENSE_ENABLED: 'true',
    };
    jest.useFakeTimers();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows consent modal when no consent exists and AdSense is enabled', async () => {
    render(<CookieConsent />);

    // Avancer le timer de 2000ms (délai dans le composant)
    jest.advanceTimersByTime(2000);

    await waitFor(() => {
      expect(screen.getByText(/Publicités adaptées à tes goûts surf\/kite/)).toBeInTheDocument();
    });
  });

  it('does not show modal when AdSense is disabled', () => {
    process.env.NEXT_PUBLIC_ADSENSE_ENABLED = 'false';
    render(<CookieConsent />);

    jest.advanceTimersByTime(2000);

    expect(screen.queryByText(/Publicités adaptées/)).not.toBeInTheDocument();
  });

  it('allows selecting essential cookies', async () => {
    const onConsentChange = jest.fn();
    render(<CookieConsent onConsentChange={onConsentChange} />);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText(/Continuer avec les pubs basiques/)).toBeInTheDocument();
    });

    act(() => {
      fireEvent.click(screen.getByText(/Continuer avec les pubs basiques/));
    });

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith('cookie-consent', 'essential');
      expect(onConsentChange).toHaveBeenCalledWith('essential');
    });
  });

  it('allows selecting personalized cookies', async () => {
    const onConsentChange = jest.fn();
    render(<CookieConsent onConsentChange={onConsentChange} />);

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByText(/J'accepte les pubs personnalisées/)).toBeInTheDocument();
    });

    act(() => {
      fireEvent.click(screen.getByText(/J'accepte les pubs personnalisées/));
    });

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalledWith('cookie-consent', 'personalized');
      expect(onConsentChange).toHaveBeenCalledWith('personalized');
    });
  });

  it('shows cookie management button when consent exists', () => {
    getItemSpy.mockReturnValue('essential');
    render(<CookieConsent />);

    expect(screen.getByTitle(/Gérer les cookies/)).toBeInTheDocument();
  });

  it('can reset consent via management button', async () => {
    getItemSpy.mockReturnValue('essential');
    render(<CookieConsent />);

    act(() => {
      fireEvent.click(screen.getByTitle(/Gérer les cookies/));
    });

    await waitFor(() => {
      expect(removeItemSpy).toHaveBeenCalledWith('cookie-consent');
    });
  });
});

describe('useCookieConsent hook', () => {
  beforeEach(() => {
    Storage.prototype.getItem = jest.fn(() => 'personalized');
    Storage.prototype.setItem = jest.fn();
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('personalized');
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns correct consent level', async () => {
    const TestComponent = () => {
      const { consentLevel, hasPersonalizedConsent, hasEssentialConsent } = useCookieConsent();
      return (
        <div>
          <span data-testid="consent-level">{consentLevel}</span>
          <span data-testid="has-personalized">{hasPersonalizedConsent.toString()}</span>
          <span data-testid="has-essential">{hasEssentialConsent.toString()}</span>
        </div>
      );
    };

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('consent-level')).toHaveTextContent('personalized');
    });
    expect(screen.getByTestId('has-personalized')).toHaveTextContent('true');
    expect(screen.getByTestId('has-essential')).toHaveTextContent('true');
  });
});