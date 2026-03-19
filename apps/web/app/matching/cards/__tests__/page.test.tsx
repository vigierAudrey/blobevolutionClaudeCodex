import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../lib/apiClient';
import Page from '../page';

jest.setTimeout(10000);

// ✅ Polyfills (TextEncoder, TextDecoder, crypto) are already set up in jest.setup.js
// Removed duplicate setup to prevent Jest worker conflicts

// Mock modules
jest.mock('next/navigation');
jest.mock('../../../../lib/apiClient');
jest.mock('../../../../lib/optimizedApiClient', () => {
  const { apiClient } = require('../../../../lib/apiClient');
  return {
    optimizedApiClient: {
      getTokens: jest.fn(() => apiClient.getTokens()),
      initializeUser: jest.fn(async () => ({
        user: await apiClient.me(),
        profile: await apiClient.getProfile(),
        disciplines: await apiClient.getDisciplines(),
      })),
      searchMatching: jest.fn((...args) => apiClient.searchMatching(...args)),
      prefetchMatchingData: jest.fn(),
      listConversations: jest.fn((...args) => apiClient.listConversations(...args)),
      matchDecisions: jest.fn((...args) => apiClient.matchDecisions(...args)),
      reportProfile: jest.fn((...args) => apiClient.reportProfile(...args)),
    },
    measureApiPerformance: jest.fn(() => ({ end: jest.fn() })),
  };
});
jest.mock('../../../../components/ui/toast', () => {
  const mockReact = require('react');
  return {
    useToast: jest.fn(() => jest.fn()),
    ToastProvider: ({ children }) => mockReact.createElement('div', { 'data-testid': 'toast-provider' }, children),
  };
});
jest.mock('framer-motion', () => {
  const mockReact = require('react');
  const MockMotion = mockReact.forwardRef(({ children, style, onDrag, onDragEnd, drag, whileTap: _unusedWhileTap, transition: _unusedTransition, className, ...rest }, ref) => {
    const handleMouseDown = (e) => {
      if (onDrag) onDrag(e, { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } });
    };
    const handleMouseUp = (e) => {
      if (onDragEnd) onDragEnd(e, { offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } });
    };

    // Filter out framer-motion specific props that would generate warnings
    const validProps = { ...rest };
    delete validProps.drag;
    delete validProps.dragConstraints;
    delete validProps.dragElastic;
    delete validProps.dragMomentum;
    delete validProps.onDrag;
    delete validProps.onDragEnd;
    delete validProps.whileTap;
    delete validProps.transition;

    return mockReact.createElement('div', {
      ref,
      style,
      className,
      onMouseDown: drag === 'x' ? handleMouseDown : undefined,
      onMouseUp: drag === 'x' ? handleMouseUp : undefined,
      ...validProps,
    }, children);
  });

  return {
    __esModule: true,
    motion: {
      div: MockMotion,
    },
    useMotionValue: () => ({ get: () => 0, set: () => {} }),
    useTransform: () => 0,
    PanInfo: {},
  };
});

const mockUseRouter = useRouter;
const mockUseSearchParams = useSearchParams;
const mockApiClient = apiClient;

// Test data
const mockProfile = {
  id: 'profile-1',
  displayName: 'Surf Rider',
  gender: 'FEMALE',
  sport: 'surf',
  level: 'intermediate',
  distanceKm: 5,
  wantsLesson: false,
};

const mockProfiles = [
  mockProfile,
  {
    id: 'profile-2',
    displayName: 'Kite Rider',
    gender: 'MALE',
    sport: 'kitesurf',
    level: 'advanced',
    distanceKm: 12,
    wantsLesson: true,
  },
];

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  role: 'RIDER',
};

const mockUserProfile = {
  displayName: 'Test User',
  photoUrl: 'https://example.com/photo.jpg',
};

const mockDisciplines = [
  { sport: 'surf', level: 'beginner' },
];

// Helper function to render with providers
function renderWithProviders(ui) {
  const { ToastProvider } = require('../../../../components/ui/toast');
  const Wrapper = ({ children }) => React.createElement(ToastProvider, null, children);
  return render(ui, { wrapper: Wrapper });
}

async function waitForInitialProfile() {
  await act(async () => { await Promise.resolve(); });
  expect(mockUseSearchParams).toHaveBeenCalled();
  await waitFor(() => expect(mockApiClient.searchMatching).toHaveBeenCalled(), { timeout: 5000 });
  const firstCallResult = mockApiClient.searchMatching.mock.results[0]?.value;
  if (firstCallResult?.then) {
    await act(async () => {
      await firstCallResult;
    });
  }
  await waitFor(() => expect(screen.getByText('Surf Rider')).toBeInTheDocument(), { timeout: 5000 });
}

async function advanceTime(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('Matching Cards Component', () => {
  const mockPush = jest.fn();
  const mockReplace = jest.fn();
  const mockSearchParams = new URLSearchParams();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    // Setup router mock
    mockUseRouter.mockReturnValue({
      push: mockPush,
      replace: mockReplace,
      back: jest.fn(),
      forward: jest.fn(),
      refresh: jest.fn(),
      prefetch: jest.fn(),
    });

    // Setup search params mock
    mockSearchParams.set('sport', 'surf');
    mockSearchParams.set('level', 'intermediate');
    mockSearchParams.set('date', '2024-01-15');
    mockSearchParams.set('useGeoloc', '1');
    mockSearchParams.set('distanceKm', '20');
    mockSearchParams.set('lat', '43.4832');
    mockSearchParams.set('lng', '-1.5586');

    const mockUrlSearchParams = {
      get: (key) => mockSearchParams.get(key),
      getAll: jest.fn(),
      has: jest.fn(),
      keys: jest.fn(),
      values: jest.fn(),
      entries: jest.fn(),
      forEach: jest.fn(),
      toString: jest.fn(),
      append: jest.fn(),
      delete: jest.fn(),
      set: jest.fn(),
      sort: jest.fn(),
      size: 0,
      [Symbol.iterator]: jest.fn(),
    };

    mockUseSearchParams.mockReturnValue(mockUrlSearchParams);

    // Setup API client mocks
    mockApiClient.getTokens.mockReturnValue({ accessToken: 'fake-token', refreshToken: 'fake-refresh' });
    mockApiClient.me.mockResolvedValue(mockUser);
    mockApiClient.getProfile.mockResolvedValue(mockUserProfile);
    mockApiClient.getDisciplines.mockResolvedValue(mockDisciplines);
    mockApiClient.searchMatching.mockResolvedValue({
      results: mockProfiles,
      total: mockProfiles.length,
    });
    mockApiClient.listConversations.mockResolvedValue({ items: [] });
    mockApiClient.matchDecisions.mockResolvedValue({ createdConversations: [] });
    (mockApiClient as unknown as typeof mockApiClient & { getConsent: jest.Mock }).getConsent = jest.fn().mockResolvedValue({ consent: null });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Authentication and Authorization', () => {
    it('should redirect to login if session bootstrap fails', async () => {
      mockApiClient.me.mockRejectedValue(new Error('Session expirée'));

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });

    it('should redirect PROs to dashboard', async () => {
      mockApiClient.me.mockResolvedValue({ ...mockUser, role: 'PRO' });

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/pro/dashboard');
      });
    });

    it('should redirect to onboarding if incomplete profile', async () => {
      mockApiClient.getProfile.mockResolvedValue({ displayName: null, photoUrl: null });

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/onboarding');
      });
    });
  });

  describe('Profile Display', () => {
    it('should display current profile information', async () => {
      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      expect(screen.getByText('Femme • Surf • Intermédiaire')).toBeInTheDocument();
      expect(screen.getByText((content) => content.includes('5 km'))).toBeInTheDocument();
    });

    it('should display lesson badge for profiles wanting lessons', async () => {
      mockApiClient.searchMatching.mockResolvedValue({
        results: [{ ...mockProfile, wantsLesson: true }],
        total: 1,
      });

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => {
        expect(screen.getByText('🎓 Cours')).toBeInTheDocument();
      });
    });

    it('should display empty state when no profiles', async () => {
      mockApiClient.searchMatching.mockResolvedValue({
        results: [],
        total: 0,
      });

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => {
        expect(screen.getByText('Plus de profils disponibles')).toBeInTheDocument();
        expect(screen.getByText('🏄‍♀️')).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should display loading indicator during initial load', async () => {
      // Make searchMatching return a promise that takes time to resolve
      mockApiClient.searchMatching.mockImplementation(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ results: mockProfiles, total: 2 }), 100);
        })
      );

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      // Initially should show loading message
      expect(screen.getByText('🔍 Recherche de profils compatibles...')).toBeInTheDocument();

      // Advance timers to resolve the promise
      await advanceTime(200);

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });
    });
  });

  describe('User Interactions', () => {
    it('should accept profile when clicking Accept button', async () => {
      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      await act(async () => {
        await user.click(acceptButton);
        await advanceTime(300);
      });

      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      });
    });

    it('should refuse profile when clicking Refuse button', async () => {
      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const refuseButton = screen.getByText('Refuser');
      await act(async () => {
        await user.click(refuseButton);
        await advanceTime(300);
      });

      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      });
    });

    it('should prevent multiple clicks during animation', async () => {
      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      const refuseButton = screen.getByText('Refuser');

      await act(async () => {
        await user.click(acceptButton);
      });

      expect(acceptButton).toBeDisabled();
      expect(refuseButton).toBeDisabled();
    });
  });

  describe('Undo Functionality', () => {
    it('should display undo button after action', async () => {
      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      await act(async () => {
        await user.click(acceptButton);
        await advanceTime(300);
      });

      await waitFor(() => {
        expect(screen.getByText('Action: Accepté — annuler dans 5 s')).toBeInTheDocument();
        expect(screen.getByText('Annuler')).toBeInTheDocument();
      });
    });

    it('should restore previous profile when undoing', async () => {
      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      await act(async () => {
        await user.click(acceptButton);
        await advanceTime(300);
      });

      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      });

      const undoButton = screen.getByText('Annuler');
      await act(async () => {
        await user.click(undoButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should hide undo button after timeout', async () => {
      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      await act(async () => {
        await user.click(acceptButton);
        await advanceTime(300);
      });

      await waitFor(() => {
        expect(screen.getByText('Annuler')).toBeInTheDocument();
      });

      await advanceTime(6000);
      expect(screen.queryByText('Annuler')).not.toBeInTheDocument();
    });
  });

  describe('Match Handling', () => {
    it('should display match popup when match is created', async () => {
      mockApiClient.matchDecisions.mockResolvedValue({
        createdConversations: [{
          conversationId: 'conv-1',
          otherDisplayName: 'Match User',
        }],
      });

      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      await act(async () => {
        await user.click(acceptButton);
        await advanceTime(300);
      });

      // Wait for decision to be added to queue, then allow batch processing
      await advanceTime(2500);

      await waitFor(() => {
        expect(mockApiClient.matchDecisions).toHaveBeenCalled();
      }, { timeout: 5000 });

      await waitFor(() => {
        expect(screen.getByText('C’est un match !')).toBeInTheDocument();
        expect(screen.getByText((content) => content.includes('Tu vas surfer avec'))).toBeInTheDocument();
        expect(screen.getByText('Match User')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should navigate to conversation when clicking message button', async () => {
      mockApiClient.matchDecisions.mockResolvedValue({
        createdConversations: [{
          conversationId: 'conv-123',
          otherDisplayName: 'Match User',
        }],
      });

      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      await act(async () => {
        await user.click(acceptButton);
        await advanceTime(300);
      });

      // Wait for decision to be added to queue, then allow batch processing
      await advanceTime(2500);

      await waitFor(() => {
        expect(mockApiClient.matchDecisions).toHaveBeenCalled();
      }, { timeout: 5000 });

      await waitFor(() => {
        expect(screen.getByText((content) => content.includes('Envoyer un message'))).toBeInTheDocument();
      }, { timeout: 5000 });

      const messageButton = screen.getByText((content) => content.includes('Envoyer un message'));
      await act(async () => {
        await user.click(messageButton);
      });

      expect(mockPush).toHaveBeenCalledWith('/messages/conv-123');
    });
  });


  describe('Decision Queue Processing', () => {
    it('should process decisions in batch after delay', async () => {
      const user = userEvent.setup();

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const acceptButton = screen.getByText('Accepter');
      await act(async () => {
        await user.click(acceptButton);
        await advanceTime(300);
      });

      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      });

      const refuseButton = screen.getByText('Refuser');
      await act(async () => {
        await user.click(refuseButton);
        await advanceTime(300);
      });

      await advanceTime(2500);

      await waitFor(() => {
        const flattenedCalls = mockApiClient.matchDecisions.mock.calls.flatMap(
          ([batch]) => batch as Array<{ targetProfileId: string; decision: string }>
        );
        expect(flattenedCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ targetProfileId: 'profile-1', decision: 'ACCEPT' }),
            expect.objectContaining({ targetProfileId: 'profile-2', decision: 'REFUSE' }),
          ])
        );
      });
    });
  });

  describe('Date Formatting', () => {
    it('should format "anytime" as "Peu importe"', async () => {
      // Set the search param to anytime
      mockSearchParams.set('date', 'anytime');

      // Mock the URLSearchParams to return anytime for date
      const mockUrlSearchParams = {
        get: (key) => {
          if (key === 'date') return 'anytime';
          return mockSearchParams.get(key);
        },
        getAll: jest.fn(),
        has: jest.fn(),
        keys: jest.fn(),
        values: jest.fn(),
        entries: jest.fn(),
        forEach: jest.fn(),
        toString: jest.fn(),
        append: jest.fn(),
        delete: jest.fn(),
        set: jest.fn(),
        sort: jest.fn(),
        size: 0,
        [Symbol.iterator]: jest.fn(),
      };

      mockUseSearchParams.mockReturnValue(mockUrlSearchParams);

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => expect(mockApiClient.searchMatching).toHaveBeenCalled(), { timeout: 3000 });
      await waitFor(() => {
        expect(
          screen.getByText(/Surf · Intermédiaire · 20 km · Peu importe/i)
        ).toBeInTheDocument();
      });
    });

    it('should format today date as "Aujourd\'hui"', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockSearchParams.set('date', today);

      // Re-mock the URLSearchParams with today's date
      const mockUrlSearchParams = {
        get: (key: string) => {
          if (key === 'date') return today;
          return mockSearchParams.get(key);
        },
        getAll: jest.fn(),
        has: jest.fn(),
        keys: jest.fn(),
        values: jest.fn(),
        entries: jest.fn(),
        forEach: jest.fn(),
        toString: jest.fn(),
        append: jest.fn(),
        delete: jest.fn(),
        set: jest.fn(),
        sort: jest.fn(),
        size: 0,
        [Symbol.iterator]: jest.fn(),
      };

      mockUseSearchParams.mockReturnValue(mockUrlSearchParams as unknown as ReturnType<typeof useSearchParams>);

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => expect(mockApiClient.searchMatching).toHaveBeenCalled(), { timeout: 3000 });
      await waitFor(() => {
        expect(screen.getByText("Aujourd'hui")).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message when loading fails', async () => {
      mockApiClient.searchMatching.mockRejectedValue(new Error('Erreur réseau'));

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitFor(() => expect(mockApiClient.searchMatching).toHaveBeenCalled(), { timeout: 3000 });
      await waitFor(() => {
        expect(screen.getByText('Erreur réseau')).toBeInTheDocument();
      });
    });
  });

  describe('Report Functionality', () => {
    it('should allow reporting a profile', async () => {
      const user = userEvent.setup();
      const mockPrompt = jest.fn().mockReturnValue('Comportement inapproprié');
      window.prompt = mockPrompt;

      await act(async () => {
        renderWithProviders(React.createElement(Page));
      });

      await waitForInitialProfile();

      const reportButton = screen.getByText('Signaler');
      await act(async () => {
        await user.click(reportButton);
      });

      expect(mockPrompt).toHaveBeenCalledWith('Motif du signalement (optionnel) :');
      expect(mockApiClient.reportProfile).toHaveBeenCalledWith({
        targetProfileId: 'profile-1',
        reason: 'Comportement inapproprié',
      });
    });
  });
});
