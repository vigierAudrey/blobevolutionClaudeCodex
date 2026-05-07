import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/apiClient';
import ProProfilePreviewPage from '../preview/page';

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
  (useRouter as jest.Mock).mockReturnValue({ replace: mockReplace, push: jest.fn(), back: jest.fn() });
});

const proUser = { id: 'user-pro-001', email: 'pro@example.com', role: 'PRO', emailVerified: true };

// Raw API response — includes private fields; toPublicProProfile() must strip all of them
const fullProfile = {
  id: 'pp-uuid-001',
  userId: 'user-pro-001',
  businessName: 'BlobPro School',
  bio: 'Cours de surf et kitesurf depuis 2010',
  photoUrl: 'https://cdn.example.com/pro-photo.jpg',
  lat: 43.7102,
  lng: -1.6002,
  radiusKm: 30,
  countryCode: 'FR',
  emailNotif: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  notificationPreferences: { pushEnabled: true },
};

describe('ProProfilePreviewPage', () => {
  describe('Auth & role guards', () => {
    it('redirects to /login when not authenticated', async () => {
      (apiClient.me as jest.Mock).mockRejectedValue(new Error('401 Unauthorized'));
      render(<ProProfilePreviewPage />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    });

    it('redirects RIDER role to /dashboard', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue({ ...proUser, role: 'RIDER' });
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
      render(<ProProfilePreviewPage />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    });

    it('redirects ADMIN role to /dashboard', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue({ ...proUser, role: 'ADMIN' });
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
      render(<ProProfilePreviewPage />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    });

    it('renders preview for authenticated PRO', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
      render(<ProProfilePreviewPage />);
      await waitFor(() => {
        expect(screen.getByTestId('preview-banner')).toBeInTheDocument();
      });
    });

    it('RIDER user: never renders preview banner or profile data', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue({ ...proUser, role: 'RIDER' });
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
      render(<ProProfilePreviewPage />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
      // setProfile() was never called — banner and profile data must be absent
      expect(screen.queryByTestId('preview-banner')).toBeNull();
      expect(screen.queryByTestId('profile-business-name')).toBeNull();
      expect(document.body.innerHTML).not.toContain('BlobPro School');
    });

    it('impossible de prévisualiser un autre profil PRO — aucun proId côté client', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      // getProProfile must be called with no arguments — no userId/proId from client
      expect(apiClient.getProProfile as jest.Mock).toHaveBeenCalledWith();
    });
  });

  describe('Preview banner', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
    });

    it('shows the private banner text', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(
        screen.getByText(/Aperçu privé — visible uniquement par vous/),
      ).toBeInTheDocument();
    });

    it('banner has role="status" for accessibility', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.getByRole('status', { name: /Aperçu privé/ })).toBeInTheDocument();
    });
  });

  describe('Profile data display', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
    });

    it('renders business name', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('profile-business-name'));
      expect(screen.getByTestId('profile-business-name')).toHaveTextContent('BlobPro School');
    });

    it('renders photo when photoUrl is set', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const img = screen.getByRole('img', { name: 'BlobPro School' });
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/pro-photo.jpg');
    });

    it('renders bio', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.getByText(/Cours de surf et kitesurf depuis 2010/)).toBeInTheDocument();
    });

    it('shows location-active indicator when lat/lng are set', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.getByTestId('location-active')).toBeInTheDocument();
    });

    it('shows location-inactive indicator when lat/lng are null', async () => {
      (apiClient.getProProfile as jest.Mock).mockResolvedValue({ ...fullProfile, lat: null, lng: null });
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.getByTestId('location-inactive')).toBeInTheDocument();
    });
  });

  describe('Private field isolation', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
    });

    it('does not render exact GPS coordinates in HTML', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const html = document.body.innerHTML;
      expect(html).not.toContain('43.7102');
      expect(html).not.toContain('-1.6002');
    });

    it('does not render emailNotif field name or value', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(document.body.innerHTML).not.toContain('emailNotif');
    });

    it('does not render internal IDs (profile id, userId)', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const html = document.body.innerHTML;
      expect(html).not.toContain('pp-uuid-001');
      expect(html).not.toContain('user-pro-001');
    });

    it('does not render the user email', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(document.body.innerHTML).not.toContain('pro@example.com');
    });

    it('does not render createdAt or updatedAt timestamps', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const html = document.body.innerHTML;
      expect(html).not.toContain('createdAt');
      expect(html).not.toContain('updatedAt');
      expect(html).not.toContain('2026-01-01');
      expect(html).not.toContain('2026-05-01');
    });

    it('does not render notificationPreferences or pushEnabled', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      const html = document.body.innerHTML;
      expect(html).not.toContain('notificationPreferences');
      expect(html).not.toContain('pushEnabled');
    });
  });

  describe('Incomplete profile', () => {
    it('shows incomplete warning when businessName and photo are missing', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue({
        ...fullProfile,
        businessName: null,
        photoUrl: null,
      });
      render(<ProProfilePreviewPage />);
      await waitFor(() => {
        expect(screen.getByTestId('incomplete-warning')).toBeInTheDocument();
      });
      expect(screen.getByText(/Nom commercial manquant/)).toBeInTheDocument();
      expect(screen.getByText(/Photo ou logo manquant/)).toBeInTheDocument();
    });

    it('does not show incomplete warning when profile is complete', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.queryByTestId('incomplete-warning')).toBeNull();
    });

    it('still renders preview banner when businessName is missing', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue({ ...fullProfile, businessName: null });
      render(<ProProfilePreviewPage />);
      await waitFor(() => {
        expect(screen.getByTestId('preview-banner')).toBeInTheDocument();
      });
    });

    it('does not crash when all optional fields are null', async () => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue({
        businessName: null,
        bio: null,
        photoUrl: null,
        lat: null,
        lng: null,
        radiusKm: null,
        countryCode: null,
      });
      render(<ProProfilePreviewPage />);
      await waitFor(() => {
        expect(screen.getByTestId('preview-banner')).toBeInTheDocument();
      });
      expect(screen.getByTestId('location-inactive')).toBeInTheDocument();
    });
  });

  describe('Readonly enforcement', () => {
    beforeEach(() => {
      (apiClient.me as jest.Mock).mockResolvedValue(proUser);
      (apiClient.getProProfile as jest.Mock).mockResolvedValue(fullProfile);
    });

    it('renders no text inputs', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('renders no select/combobox elements', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('renders no file input', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it('renders no form elements', async () => {
      render(<ProProfilePreviewPage />);
      await waitFor(() => screen.getByTestId('preview-banner'));
      expect(screen.queryByRole('form')).toBeNull();
    });
  });
});
