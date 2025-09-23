import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CookieConsent, useCookieConsent } from '../CookieConsent';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock as any;

// Mock environment variables
const originalEnv = process.env;

describe('CookieConsent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ADSENSE_ENABLED: 'true',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('shows consent modal when no consent exists and AdSense is enabled', async () => {
    render(<CookieConsent />);

    await waitFor(() => {
      expect(screen.getByText(/Publicités adaptées à tes goûts surf\/kite/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('does not show modal when AdSense is disabled', () => {
    process.env.NEXT_PUBLIC_ADSENSE_ENABLED = 'false';
    render(<CookieConsent />);

    expect(screen.queryByText(/Publicités adaptées/)).not.toBeInTheDocument();
  });

  it('allows selecting essential cookies', async () => {
    const onConsentChange = jest.fn();
    render(<CookieConsent onConsentChange={onConsentChange} />);

    await waitFor(() => {
      expect(screen.getByText(/Continuer avec les pubs basiques/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Continuer avec les pubs basiques/));

    expect(localStorageMock.setItem).toHaveBeenCalledWith('cookie-consent', 'essential');
    expect(onConsentChange).toHaveBeenCalledWith('essential');
  });

  it('allows selecting personalized cookies', async () => {
    const onConsentChange = jest.fn();
    render(<CookieConsent onConsentChange={onConsentChange} />);

    await waitFor(() => {
      expect(screen.getByText(/J'accepte les pubs personnalisées/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/J'accepte les pubs personnalisées/));

    expect(localStorageMock.setItem).toHaveBeenCalledWith('cookie-consent', 'personalized');
    expect(onConsentChange).toHaveBeenCalledWith('personalized');
  });

  it('shows cookie management button when consent exists', () => {
    localStorageMock.getItem.mockReturnValue('essential');
    render(<CookieConsent />);

    expect(screen.getByTitle(/Gérer les cookies/)).toBeInTheDocument();
  });

  it('can reset consent via management button', () => {
    localStorageMock.getItem.mockReturnValue('essential');
    render(<CookieConsent />);

    fireEvent.click(screen.getByTitle(/Gérer les cookies/));

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('cookie-consent');
  });
});

describe('useCookieConsent hook', () => {
  it('returns correct consent level', () => {
    localStorageMock.getItem.mockReturnValue('personalized');

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

    expect(screen.getByTestId('consent-level')).toHaveTextContent('personalized');
    expect(screen.getByTestId('has-personalized')).toHaveTextContent('true');
    expect(screen.getByTestId('has-essential')).toHaveTextContent('true');
  });
});