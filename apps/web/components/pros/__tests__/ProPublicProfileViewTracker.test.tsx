import { render } from '@testing-library/react';
import { useAnalytics } from '@/hooks/useAnalytics';
import { ProPublicProfileViewTracker } from '../ProPublicProfileViewTracker';

jest.mock('@/hooks/useAnalytics', () => ({ useAnalytics: jest.fn() }));

const mockUseAnalytics = useAnalytics as jest.Mock;

describe('ProPublicProfileViewTracker', () => {
  it('fires PUBLIC_PRO_PROFILE_VIEW once on mount with the slug as contentId', () => {
    const trackEvent = jest.fn();
    mockUseAnalytics.mockReturnValue({ trackEvent });

    const { rerender } = render(<ProPublicProfileViewTracker slug="blob-surf-school" />);

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith({
      eventType: 'PUBLIC_PRO_PROFILE_VIEW',
      contentId: 'blob-surf-school',
    });

    rerender(<ProPublicProfileViewTracker slug="blob-surf-school" />);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  it('renders nothing', () => {
    mockUseAnalytics.mockReturnValue({ trackEvent: jest.fn() });
    const { container } = render(<ProPublicProfileViewTracker slug="blob-surf-school" />);
    expect(container).toBeEmptyDOMElement();
  });
});
