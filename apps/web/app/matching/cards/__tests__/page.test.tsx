import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../lib/apiClient';
import Page from '../page';

// Mock des modules
jest.mock('next/navigation');
jest.mock('../../../../lib/apiClient');

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseSearchParams = useSearchParams as jest.MockedFunction<typeof useSearchParams>;
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// Mock des données de test
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

describe('Matching Cards Component', () => {
  const mockPush = jest.fn();
  const mockReplace = jest.fn();
  const mockSearchParams = new URLSearchParams();

  beforeEach(() => {
    jest.clearAllMocks();

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

    mockUseSearchParams.mockReturnValue({
      get: (key: string) => mockSearchParams.get(key),
      getAll: jest.fn(),
      has: jest.fn(),
      keys: jest.fn(),
      values: jest.fn(),
      entries: jest.fn(),
      forEach: jest.fn(),
      toString: jest.fn(),
    });

    // Setup API client mocks
    mockApiClient.getTokens.mockReturnValue({ accessToken: 'fake-token' });
    mockApiClient.me.mockResolvedValue(mockUser);
    mockApiClient.getProfile.mockResolvedValue(mockUserProfile);
    mockApiClient.getDisciplines.mockResolvedValue(mockDisciplines);
    mockApiClient.searchMatching.mockResolvedValue({
      results: mockProfiles,
      total: mockProfiles.length,
    });
    mockApiClient.listConversations.mockResolvedValue({ items: [] });
    mockApiClient.matchDecisions.mockResolvedValue({ createdConversations: [] });
  });

  describe('Authentification et autorisation', () => {
    it('devrait rediriger vers login si pas de token', async () => {
      mockApiClient.getTokens.mockReturnValue(null);

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/login');
      });
    });

    it('devrait rediriger les PROs vers le dashboard', async () => {
      mockApiClient.me.mockResolvedValue({ ...mockUser, role: 'PRO' });

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/pro/dashboard');
      });
    });

    it('devrait rediriger vers onboarding si profil incomplet', async () => {
      mockApiClient.getProfile.mockResolvedValue({ displayName: null, photoUrl: null });

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/onboarding');
      });
    });
  });

  describe('Affichage des cartes de profils', () => {
    it('devrait afficher les informations du profil courant', async () => {
      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
        expect(screen.getByText('Femme • surf • intermediate')).toBeInTheDocument();
        expect(screen.getByText('5 km')).toBeInTheDocument();
      });
    });

    it('devrait afficher le badge "Cours" pour les profils qui veulent des leçons', async () => {
      mockApiClient.searchMatching.mockResolvedValue({
        results: [{ ...mockProfile, wantsLesson: true }],
        total: 1,
      });

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('🎓 Cours')).toBeInTheDocument();
      });
    });

    it('devrait afficher la date formatée correctement', async () => {
      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('📅')).toBeInTheDocument();
      });
    });

    it('devrait afficher le message "Plus de profils" quand la liste est vide', async () => {
      mockApiClient.searchMatching.mockResolvedValue({
        results: [],
        total: 0,
      });

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Plus de profils disponibles')).toBeInTheDocument();
        expect(screen.getByText('🏄‍♀️')).toBeInTheDocument();
      });
    });
  });

  describe('Interactions de swipe', () => {
    it('devrait accepter un profil en cliquant sur "Accepter"', async () => {
      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const acceptButton = screen.getByText('Accepter');
      await user.click(acceptButton);

      // Vérifier l'animation
      await waitFor(() => {
        const cardElement = screen.getByText('Surf Rider').closest('div');
        expect(cardElement).toHaveClass('translate-x-24', 'opacity-0');
      });

      // Vérifier le passage au profil suivant après l'animation
      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      }, { timeout: 1000 });
    });

    it('devrait refuser un profil en cliquant sur "Refuser"', async () => {
      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const refuseButton = screen.getByText('Refuser');
      await user.click(refuseButton);

      // Vérifier l'animation vers la gauche
      await waitFor(() => {
        const cardElement = screen.getByText('Surf Rider').closest('div');
        expect(cardElement).toHaveClass('-translate-x-24', 'opacity-0');
      });

      // Vérifier le passage au profil suivant
      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      }, { timeout: 1000 });
    });

    it('devrait empêcher les clics multiples pendant l\'animation', async () => {
      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const acceptButton = screen.getByText('Accepter');
      const refuseButton = screen.getByText('Refuser');

      // Premier clic
      await user.click(acceptButton);

      // Vérifier que les boutons sont désactivés pendant l'animation
      expect(acceptButton).toBeDisabled();
      expect(refuseButton).toBeDisabled();
    });
  });

  describe('Fonction d\'annulation (undo)', () => {
    it('devrait afficher le bouton d\'annulation après une action', async () => {
      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const acceptButton = screen.getByText('Accepter');
      await user.click(acceptButton);

      await waitFor(() => {
        expect(screen.getByText('Action: Accepté — annuler dans 5 s')).toBeInTheDocument();
        expect(screen.getByText('Annuler')).toBeInTheDocument();
      });
    });

    it('devrait restaurer le profil précédent lors de l\'annulation', async () => {
      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      // Accepter le profil
      const acceptButton = screen.getByText('Accepter');
      await user.click(acceptButton);

      // Attendre le passage au profil suivant
      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      }, { timeout: 1000 });

      // Cliquer sur Annuler
      const undoButton = screen.getByText('Annuler');
      await user.click(undoButton);

      // Vérifier que le profil précédent est restauré
      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });
    });

    it('devrait masquer le bouton d\'annulation après 5 secondes', async () => {
      jest.useFakeTimers();
      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const acceptButton = screen.getByText('Accepter');
      await user.click(acceptButton);

      await waitFor(() => {
        expect(screen.getByText('Annuler')).toBeInTheDocument();
      });

      // Avancer le temps de 5 secondes
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      await waitFor(() => {
        expect(screen.queryByText('Annuler')).not.toBeInTheDocument();
      });

      jest.useRealTimers();
    });
  });

  describe('Gestion des matches', () => {
    it('devrait afficher la popup de match quand un match est créé', async () => {
      mockApiClient.matchDecisions.mockResolvedValue({
        createdConversations: [{
          conversationId: 'conv-1',
          otherDisplayName: 'Match User',
        }],
      });

      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const acceptButton = screen.getByText('Accepter');
      await user.click(acceptButton);

      // Attendre que la décision soit traitée (après 5 secondes)
      jest.useFakeTimers();
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      await waitFor(() => {
        expect(screen.getByText('C\'est un match !')).toBeInTheDocument();
        expect(screen.getByText('Tu vas pouvoir surfer avec Match User')).toBeInTheDocument();
      });

      jest.useRealTimers();
    });

    it('devrait naviguer vers la conversation lors du clic sur "Envoyer un message"', async () => {
      mockApiClient.matchDecisions.mockResolvedValue({
        createdConversations: [{
          conversationId: 'conv-123',
          otherDisplayName: 'Match User',
        }],
      });

      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      // Simuler un match
      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const acceptButton = screen.getByText('Accepter');
      await user.click(acceptButton);

      // Avancer le temps pour déclencher le traitement du match
      jest.useFakeTimers();
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      await waitFor(() => {
        expect(screen.getByText('Envoyer un message 🚀')).toBeInTheDocument();
      });

      const messageButton = screen.getByText('Envoyer un message 🚀');
      await user.click(messageButton);

      expect(mockPush).toHaveBeenCalledWith('/messages/conv-123');

      jest.useRealTimers();
    });
  });

  describe('Fonction de signalement', () => {
    it('devrait permettre de signaler un profil', async () => {
      const user = userEvent.setup();
      const mockPrompt = jest.fn().mockReturnValue('Comportement inapproprié');
      window.prompt = mockPrompt;

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      const reportButton = screen.getByText('Signaler');
      await user.click(reportButton);

      expect(mockPrompt).toHaveBeenCalledWith('Motif du signalement (optionnel) :');
      expect(mockApiClient.reportProfile).toHaveBeenCalledWith({
        targetProfileId: 'profile-1',
        reason: 'Comportement inapproprié',
      });
    });
  });

  describe('Chargement et pagination', () => {
    it('devrait afficher un indicateur de chargement initial', async () => {
      mockApiClient.searchMatching.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ results: mockProfiles, total: 2 }), 100))
      );

      await act(async () => {
        render(<Page />);
      });

      expect(screen.getByText('Chargement…')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });
    });

    it('devrait précharger les profils suivants quand proche de la fin', async () => {
      // Mock une première recherche avec 2 profils
      mockApiClient.searchMatching.mockResolvedValueOnce({
        results: mockProfiles,
        total: 2,
      });

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      // Passer au dernier profil devrait déclencher un préchargement
      const acceptButton = screen.getByText('Accepter');
      const user = userEvent.setup();
      await user.click(acceptButton);

      // Vérifier qu'une nouvelle recherche est déclenchée pour le préchargement
      await waitFor(() => {
        expect(mockApiClient.searchMatching).toHaveBeenCalledTimes(2);
      });
    });

    it('devrait gérer les erreurs de chargement', async () => {
      mockApiClient.searchMatching.mockRejectedValue(new Error('Erreur réseau'));

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Erreur réseau')).toBeInTheDocument();
      });
    });
  });

  describe('Formatage des dates', () => {
    it('devrait formater "anytime" comme "Peu importe"', async () => {
      mockSearchParams.set('date', 'anytime');

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Peu importe')).toBeInTheDocument();
      });
    });

    it('devrait formater la date d\'aujourd\'hui comme "Aujourd\'hui"', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockSearchParams.set('date', today);

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Aujourd\'hui')).toBeInTheDocument();
      });
    });

    it('devrait formater la date de demain comme "Demain"', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      mockSearchParams.set('date', tomorrow);

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Demain')).toBeInTheDocument();
      });
    });
  });

  describe('Queue des décisions', () => {
    it('devrait traiter les décisions par batch toutes les 2 secondes', async () => {
      jest.useFakeTimers();
      const user = userEvent.setup();

      await act(async () => {
        render(<Page />);
      });

      await waitFor(() => {
        expect(screen.getByText('Surf Rider')).toBeInTheDocument();
      });

      // Faire plusieurs actions
      const acceptButton = screen.getByText('Accepter');
      await user.click(acceptButton);

      await waitFor(() => {
        expect(screen.getByText('Kite Rider')).toBeInTheDocument();
      }, { timeout: 1000 });

      const refuseButton = screen.getByText('Refuser');
      await user.click(refuseButton);

      // Avancer le temps pour déclencher le flush
      act(() => {
        jest.advanceTimersByTime(7000); // 5s + 2s pour être sûr
      });

      await waitFor(() => {
        expect(mockApiClient.matchDecisions).toHaveBeenCalledWith([
          { targetProfileId: 'profile-1', decision: 'ACCEPT' },
          { targetProfileId: 'profile-2', decision: 'REFUSE' },
        ]);
      });

      jest.useRealTimers();
    });
  });
});