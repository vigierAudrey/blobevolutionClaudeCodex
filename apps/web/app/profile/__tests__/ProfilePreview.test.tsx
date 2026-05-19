import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import ProfilePreviewPage from '../preview/page';

// next/image is not mocked globally — stub it here
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

jest.mock('@/components/BackBar', () => ({
  BackBar: () => <nav aria-label="back" />,
}));

jest.mock('@/components/ui/spinner', () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

const mockReplace = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  // Override the global useRouter mock (from jest.setup.js) with a controlled instance
  (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace, push: jest.fn(), back: jest.fn() });
});

const riderUser = { id: 'user-abc', email: 'rider@example.com', role: 'RIDER', emailVerified: true };

const fullProfile = {
  id: 'profile-xyz',
  userId: 'user-abc',
  displayName: 'Blobmama',
  bio: 'Surfeuse depuis 10 ans',
  sex: 'FEMALE' as const,
  photoUrl: 'https://cdn.example.com/photo.jpg',
  wantsLesson: false,
  lessonPlace: null,
  lessonDate: null,
  lessonStudentCount: null,
  // private fields — must never appear in rendered HTML
  lat: 43.7102,
  lng: -1.6002,
  maxDistanceKm: 30,
  emailNotif: true,
  lessonLat: 43.8,
  lessonLng: -1.7,
};

describe('ProfilePreviewPage', () => {
  describe('Auth & role guards', () => {
    it('redirects to /login when not authenticated', async () => {
      (apiClient.me as jest.Mock).mockRejectedValue(new Error('401 Unauthorized'));
      render(<ProfilePreviewPage />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    });

    it('redirects non-RIDER role to /dashboard', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue({ ...riderUser, role: 'PRO' });
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([]);
      render(<ProfilePreviewPage />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    });

    it('PRO user: never renders preview banner or profile data', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue({ ...riderUser, role: 'PRO' });
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([]);
      render(<ProfilePreviewPage />);
      // Wait until the redirect fires (auth check complete, role rejected)
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
      // setProfile() was never called → banner and profile data must be absent
      expect(screen.queryByTestId('preview-banner')).toBeNull();
      expect(screen.queryByTestId('profile-display-name')).toBeNull();
      expect(document.body.innerHTML).not.toContain('Blobmama');
    });

    it('renders preview for authenticated RIDER', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([]);
      render(<ProfilePreviewPage />);
      await waitFor(() => {
        expect(screen.getByTestId('preview-banner')).toBeInTheDocument();
      });
    });
  });

  describe('Preview banner', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([{ sport: 'surf', level: 'intermediate' }]);
    });

    it('shows the private banner text', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(
        screen.getByText(/Aperçu privé — visible uniquement par vous/),
      ).toBeInTheDocument();
    });

    it('banner has role="status" for accessibility', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.getByRole('status', { name: /Aperçu privé/ })).toBeInTheDocument();
    });
  });

  describe('Profile data display', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([
        { sport: 'surf', level: 'intermediate' },
      ]);
    });

    it('renders display name', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('profile-display-name'));
      expect(screen.getByTestId('profile-display-name')).toHaveTextContent('Blobmama');
    });

    it('renders photo when photoUrl is set', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const img = screen.getByRole('img', { name: 'Blobmama' });
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/photo.jpg');
    });

    it('renders discipline badge', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.getByText(/Surf · Intermédiaire/)).toBeInTheDocument();
    });

    it('renders bio', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.getByText(/Surfeuse depuis 10 ans/)).toBeInTheDocument();
    });
  });

  describe('Private field isolation', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([]);
    });

    it('does not render GPS coordinates in HTML', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const html = document.body.innerHTML;
      expect(html).not.toContain('43.7102');
      expect(html).not.toContain('-1.6002');
      expect(html).not.toContain('43.8');
      expect(html).not.toContain('-1.7');
    });

    it('does not render internal field names', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const html = document.body.innerHTML;
      expect(html).not.toContain('maxDistanceKm');
      expect(html).not.toContain('emailNotif');
    });

    it('does not render internal IDs', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const html = document.body.innerHTML;
      // userId and profile id must not leak into the rendered output
      expect(html).not.toContain('user-abc');
      expect(html).not.toContain('profile-xyz');
    });

    it('does not render the user email', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(document.body.innerHTML).not.toContain('rider@example.com');
    });
  });

  describe('Incomplete profile', () => {
    it('shows incomplete warning when name, photo, and disciplines are missing', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue({
        ...fullProfile,
        displayName: null,
        photoUrl: null,
      });
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([]);
      render(<ProfilePreviewPage />);
      await waitFor(() => {
        expect(screen.getByTestId('incomplete-warning')).toBeInTheDocument();
      });
      expect(screen.getByText(/Nom affiché manquant/)).toBeInTheDocument();
      expect(screen.getByText(/Photo de profil manquant/)).toBeInTheDocument();
      expect(screen.getByText(/Discipline/)).toBeInTheDocument();
    });

    it('does not show incomplete warning when profile is complete', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([{ sport: 'surf', level: 'beginner' }]);
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.queryByTestId('incomplete-warning')).toBeNull();
    });

    it('still renders preview banner when profile is incomplete', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue({ ...fullProfile, displayName: null });
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([]);
      render(<ProfilePreviewPage />);
      await waitFor(() => {
        expect(screen.getByTestId('preview-banner')).toBeInTheDocument();
      });
    });
  });

  describe('Readonly enforcement', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(riderUser);
      (apiClient.getProfile as jest.Mock).mockResolvedValue(fullProfile);
      (apiClient.getDisciplines as jest.Mock).mockResolvedValue([]);
    });

    it('renders no text inputs', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('renders no select/combobox elements', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('renders no file input', async () => {
      render(<ProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      // type="file" inputs are not accessible by role — check directly
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });
  });
});
