import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { CookieConsent, useCookieConsent } from '../CookieConsent';
import { useConsent } from '../../../hooks/useConsent';

jest.mock('../../../hooks/useConsent', () => ({
  useConsent: jest.fn(),
}));

type MockConsent = ReturnType<typeof useConsent> extends infer T ? (T extends object ? T : never) : never;

const mockUseConsent = useConsent as jest.MockedFunction<typeof useConsent>;

const createConsentState = (overrides: Partial<MockConsent> = {}): MockConsent => ({
  consentMode: 'none',
  consentSignals: {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  },
  consentReady: true,
  consentSource: 'local',
  userHash: 'hash',
  cmpVersion: 'cmp-v',
  updateConsent: jest.fn(),
  houseAdsEnabled: true,
  ...overrides,
});

const originalEnv = process.env;

describe('CookieConsent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ADSENSE_ENABLED: 'true',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('shows consent modal when consent is missing', async () => {
    mockUseConsent.mockReturnValue(createConsentState({ consentMode: 'none' }));

    render(<CookieConsent />);

    expect(await screen.findByText(/Publicités adaptées à tes goûts surf\/kite/)).toBeInTheDocument();
  });

  it('continue d’afficher le consentement même sans AdSense quand le consentement manque', async () => {
    process.env.NEXT_PUBLIC_ADSENSE_ENABLED = 'false';
    mockUseConsent.mockReturnValue(createConsentState({ consentMode: 'none' }));

    render(<CookieConsent />);

    expect(await screen.findByText(/Publicités adaptées/)).toBeInTheDocument();
  });

  it('calls updateConsent with npa for basic ads', async () => {
    const updateConsent = jest.fn().mockResolvedValue(undefined);
    mockUseConsent.mockReturnValue(createConsentState({ consentMode: 'none', updateConsent }));
    const onConsentChange = jest.fn();

    render(<CookieConsent onConsentChange={onConsentChange} />);

    const button = await screen.findByText(/Continuer avec les pubs basiques/);
    act(() => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(updateConsent).toHaveBeenCalledWith('npa');
      expect(onConsentChange).toHaveBeenCalledWith('essential');
    });
  });

  it('calls updateConsent with personalized for full consent', async () => {
    const updateConsent = jest.fn().mockResolvedValue(undefined);
    mockUseConsent.mockReturnValue(createConsentState({ consentMode: 'none', updateConsent }));
    const onConsentChange = jest.fn();

    render(<CookieConsent onConsentChange={onConsentChange} />);

    const button = await screen.findByText(/J'accepte les pubs personnalisées/);
    act(() => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(updateConsent).toHaveBeenCalledWith('personalized');
      expect(onConsentChange).toHaveBeenCalledWith('personalized');
    });
  });

  it('calls updateConsent with limited mode', async () => {
    const updateConsent = jest.fn().mockResolvedValue(undefined);
    mockUseConsent.mockReturnValue(createConsentState({ consentMode: 'none', updateConsent }));

    render(<CookieConsent />);

    const button = await screen.findByText(/Utiliser les pubs limitées/);
    act(() => {
      fireEvent.click(button);
    });

    expect(updateConsent).toHaveBeenCalledWith('npa');
  });

  it('calls updateConsent with none when refusing all ads', async () => {
    const updateConsent = jest.fn().mockResolvedValue(undefined);
    mockUseConsent.mockReturnValue(createConsentState({ consentMode: 'none', updateConsent }));

    render(<CookieConsent />);

    const link = await screen.findByText(/Refuser toutes les publicités/i);
    act(() => {
      fireEvent.click(link);
    });

    expect(updateConsent).toHaveBeenCalledWith('none');
  });

  it('shows management button when consent already given', async () => {
    mockUseConsent.mockReturnValue(
      createConsentState({
        consentMode: 'npa',
        houseAdsEnabled: false,
      }),
    );

    render(<CookieConsent />);

    expect(await screen.findByTitle(/Gérer les cookies/)).toBeInTheDocument();
  });
});

describe('useCookieConsent hook', () => {
  it('maps consent info from useConsent', () => {
    mockUseConsent.mockReturnValue(
      createConsentState({
        consentMode: 'personalized',
        houseAdsEnabled: false,
      }),
    );

    const TestComponent = () => {
      const { consentLevel, hasPersonalizedConsent, hasEssentialConsent } = useCookieConsent();
      return (
        <div>
          <span data-testid="level">{consentLevel}</span>
          <span data-testid="personalized">{hasPersonalizedConsent.toString()}</span>
          <span data-testid="essential">{hasEssentialConsent.toString()}</span>
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('level')).toHaveTextContent('personalized');
    expect(screen.getByTestId('personalized')).toHaveTextContent('true');
    expect(screen.getByTestId('essential')).toHaveTextContent('true');
  });
});
