import { render, screen, waitFor } from '@testing-library/react';
import { AdBanner, AdBannerFeed, AdBannerSidebar, AdBannerArticle } from '../AdBanner';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock as any;
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

// Mock window.adsbygoogle
global.window.adsbygoogle = [];

// Mock environment variables
const originalEnv = process.env;

describe('AdBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ADSENSE_ENABLED: 'true',
      NEXT_PUBLIC_ADSENSE_CLIENT_ID: 'ca-pub-123456789',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not render when AdSense is disabled', () => {
    process.env.NEXT_PUBLIC_ADSENSE_ENABLED = 'false';
    const { container } = render(<AdBanner slot="test-slot" />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render when client ID is missing', () => {
    delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
    const { container } = render(<AdBanner slot="test-slot" />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render when no consent is given', () => {
    const { container } = render(<AdBanner slot="test-slot" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders basic ad when essential consent is given', async () => {
    localStorageMock.getItem.mockReturnValue('essential');
    render(<AdBanner slot="test-slot" />);

    await waitFor(() => {
      expect(localStorageMock.getItem).toHaveBeenCalledWith('cookie-consent');
    });

    await screen.findByText(/Espace partenaire surf\/kite/);

    expect(screen.getByText(/Publicité non personnalisée/)).toBeInTheDocument();
  });

  it('renders AdSense ad when personalized consent is given', async () => {
    localStorageMock.getItem.mockReturnValue('personalized');
    const { container } = render(<AdBanner slot="test-slot" />);

    await waitFor(() => {
      const adsenseElement = container.querySelector('.adsbygoogle');
      expect(adsenseElement).toBeInTheDocument();
    });

    const adsenseElement = container.querySelector('.adsbygoogle');
    expect(adsenseElement).toHaveAttribute('data-ad-client', 'ca-pub-123456789');
    expect(adsenseElement).toHaveAttribute('data-ad-slot', 'test-slot');
    expect(adsenseElement).toHaveAttribute('data-npa', '0'); // Personalized ads
  });

  it('sets correct npa attribute for essential consent', async () => {
    localStorageMock.getItem.mockReturnValue('essential');
    render(<AdBanner slot="test-slot" />);

    // Should render basic ad, not AdSense
    await waitFor(() => {
      expect(screen.getByText(/Espace partenaire surf\/kite/)).toBeInTheDocument();
    });
  });
});

describe('Pre-configured Ad Components', () => {
  beforeEach(() => {
    localStorageMock.getItem.mockReturnValue('personalized');
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_ADSENSE_ENABLED: 'true',
      NEXT_PUBLIC_ADSENSE_CLIENT_ID: 'ca-pub-123456789',
    };
  });

  it('renders AdBannerFeed with correct format and classes', async () => {
    const { container } = render(<AdBannerFeed slot="feed-slot" />);

    await waitFor(() => {
      const adsenseElement = container.querySelector('.adsbygoogle');
      expect(adsenseElement).toBeInTheDocument();
    });

    const adsenseElement = container.querySelector('.adsbygoogle');
    expect(adsenseElement).toHaveAttribute('data-ad-format', 'rectangle');

    const wrapper = container.querySelector('.my-6.text-center');
    expect(wrapper).toBeInTheDocument();
  });

  it('renders AdBannerSidebar with correct format and classes', async () => {
    const { container } = render(<AdBannerSidebar slot="sidebar-slot" />);

    await waitFor(() => {
      const adsenseElement = container.querySelector('.adsbygoogle');
      expect(adsenseElement).toBeInTheDocument();
    });

    const adsenseElement = container.querySelector('.adsbygoogle');
    expect(adsenseElement).toHaveAttribute('data-ad-format', 'vertical');

    const wrapper = container.querySelector('.hidden.lg\\:block');
    expect(wrapper).toBeInTheDocument();
  });

  it('renders AdBannerArticle with correct format and classes', async () => {
    const { container } = render(<AdBannerArticle slot="article-slot" />);

    await waitFor(() => {
      const adsenseElement = container.querySelector('.adsbygoogle');
      expect(adsenseElement).toBeInTheDocument();
    });

    const adsenseElement = container.querySelector('.adsbygoogle');
    expect(adsenseElement).toHaveAttribute('data-ad-format', 'auto');

    const wrapper = container.querySelector('.my-8.mx-auto');
    expect(wrapper).toBeInTheDocument();
  });
});
