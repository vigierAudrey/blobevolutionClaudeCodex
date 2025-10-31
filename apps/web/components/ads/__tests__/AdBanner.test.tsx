import { render, screen, waitFor } from '@testing-library/react';
import { AdBanner, AdBannerFeed, AdBannerSidebar, AdBannerArticle } from '../AdBanner';
import { useConsent } from '../../../hooks/useConsent';
import { loadAdSense } from '../../../lib/ads/loadAdSense';

jest.mock('../../../hooks/useConsent', () => ({
  useConsent: jest.fn(),
}));

jest.mock('../../../lib/ads/loadAdSense', () => ({
  loadAdSense: jest.fn().mockResolvedValue(undefined),
}));

const originalEnv = process.env;
const mockUseConsent = useConsent as jest.MockedFunction<typeof useConsent>;
const mockLoadAdSense = loadAdSense as jest.MockedFunction<typeof loadAdSense>;

const baseConsent = (overrides: Partial<ReturnType<typeof useConsent>> = {}) => ({
  consentMode: 'none' as const,
  consentSignals: {
    ad_storage: 'denied' as const,
    ad_user_data: 'denied' as const,
    ad_personalization: 'denied' as const,
  },
  consentReady: true,
  consentSource: 'local' as const,
  userHash: 'hash',
  cmpVersion: 'cmp-v',
  updateConsent: jest.fn(),
  houseAdsEnabled: true,
  ...overrides,
});

describe('AdBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ADSENSE_ENABLED: 'true',
      NEXT_PUBLIC_ADSENSE_CLIENT_ID: 'ca-pub-123456789',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('renders configuration house ad when AdSense is disabled', () => {
    process.env.NEXT_PUBLIC_ADSENSE_ENABLED = 'false';
    mockUseConsent.mockReturnValue(baseConsent());

    render(<AdBanner slot="test-slot" />);

    expect(screen.getByText(/Espace partenaire/i)).toBeInTheDocument();
    expect(mockLoadAdSense).not.toHaveBeenCalled();
  });

  it('renders loading house ad when consent not ready', () => {
    mockUseConsent.mockReturnValue(baseConsent({ consentReady: false }));

    render(<AdBanner slot="test-slot" />);

    expect(screen.getByText(/Préférences en cours/i)).toBeInTheDocument();
  });

  it('renders house ad when consent mode is none', () => {
    mockUseConsent.mockReturnValue(baseConsent({ consentMode: 'none' }));

    render(<AdBanner slot="test-slot" />);

    expect(screen.getByText(/Blobinfini House Ads/i)).toBeInTheDocument();
    expect(mockLoadAdSense).not.toHaveBeenCalled();
  });

  it('renders AdSense tag with NPA when consent mode is npa', async () => {
    mockUseConsent.mockReturnValue(
      baseConsent({
        consentMode: 'npa',
        consentSignals: {
          ad_storage: 'granted',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
        },
        houseAdsEnabled: false,
      }),
    );

    const { container } = render(<AdBanner slot="test-slot" />);

    await waitFor(() => {
      expect(container.querySelector('.adsbygoogle')).toBeInTheDocument();
    });

    const ins = container.querySelector('.adsbygoogle');
    expect(ins).toHaveAttribute('data-npa', '1');
    expect(mockLoadAdSense).toHaveBeenCalled();
  });

  it('renders AdSense tag with personalized mode', async () => {
    mockUseConsent.mockReturnValue(
      baseConsent({
        consentMode: 'personalized',
        consentSignals: {
          ad_storage: 'granted',
          ad_user_data: 'granted',
          ad_personalization: 'granted',
        },
        houseAdsEnabled: false,
      }),
    );

    const { container } = render(<AdBanner slot="test-slot" />);

    await waitFor(() => {
      expect(container.querySelector('.adsbygoogle')).toBeInTheDocument();
    });

    const ins = container.querySelector('.adsbygoogle');
    expect(ins).toHaveAttribute('data-npa', '0');
  });
});

describe('Pre-configured Ad Components', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ADSENSE_ENABLED: 'true',
      NEXT_PUBLIC_ADSENSE_CLIENT_ID: 'ca-pub-123456789',
    };
    mockUseConsent.mockReturnValue(
      baseConsent({
        consentMode: 'personalized',
        consentSignals: {
          ad_storage: 'granted',
          ad_user_data: 'granted',
          ad_personalization: 'granted',
        },
        houseAdsEnabled: false,
      }),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('renders AdBannerFeed with correct format and classes', async () => {
    const { container } = render(<AdBannerFeed slot="feed-slot" />);

    await waitFor(() => {
      expect(container.querySelector('.adsbygoogle')).toBeInTheDocument();
    });

    const ins = container.querySelector('.adsbygoogle');
    expect(ins).toHaveAttribute('data-ad-format', 'rectangle');
    expect(container.querySelector('.my-6.text-center')).toBeInTheDocument();
  });

  it('renders AdBannerSidebar with correct format and classes', async () => {
    const { container } = render(<AdBannerSidebar slot="sidebar-slot" />);

    await waitFor(() => {
      expect(container.querySelector('.adsbygoogle')).toBeInTheDocument();
    });

    const ins = container.querySelector('.adsbygoogle');
    expect(ins).toHaveAttribute('data-ad-format', 'vertical');
    expect(container.querySelector('.hidden.lg\\:block')).toBeInTheDocument();
  });

  it('renders AdBannerArticle with correct format and classes', async () => {
    const { container } = render(<AdBannerArticle slot="article-slot" />);

    await waitFor(() => {
      expect(container.querySelector('.adsbygoogle')).toBeInTheDocument();
    });

    const ins = container.querySelector('.adsbygoogle');
    expect(ins).toHaveAttribute('data-ad-format', 'auto');
    expect(container.querySelector('.my-8.mx-auto')).toBeInTheDocument();
  });
});
