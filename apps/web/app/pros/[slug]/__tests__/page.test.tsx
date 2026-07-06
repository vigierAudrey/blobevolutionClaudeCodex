/**
 * Tests — page publique /pros/[slug] (Server Component).
 * Couvre : 404 sur profil absent, rendu du profil complet, metadata SEO,
 * offres groupées par sport, fallback sans photo/sans offres.
 */
import { notFound } from 'next/navigation';
import { render, screen } from '@testing-library/react';
import ProPublicProfilePage, { generateMetadata } from '../page';
import { loadPublicProProfile } from '@/lib/pros/loadPublicProProfile';

jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));

jest.mock('@/lib/pros/loadPublicProProfile', () => {
  const actual = jest.requireActual('@/lib/pros/loadPublicProProfile');
  return { ...actual, loadPublicProProfile: jest.fn() };
});

jest.mock('@/components/home/HomeHeader', () => ({ HomeHeader: () => <header data-testid="home-header" /> }));
jest.mock('@/components/home/HomeFooter', () => ({ HomeFooter: () => <footer data-testid="home-footer" /> }));
jest.mock('@/components/pros/ProPublicProfileViewTracker', () => ({
  ProPublicProfileViewTracker: () => null,
}));

const mockLoadProfile = loadPublicProProfile as jest.Mock;
const mockNotFound = jest.mocked(notFound);

const fullProfile = {
  slug: 'blob-surf-school',
  businessName: 'Blob Surf School',
  bio: 'Cours de surf tous niveaux à Lacanau.',
  photoUrl: 'https://cdn.example.com/photo.jpg',
  publicCity: 'Lacanau',
  pricePerHour: null,
  verified: true,
  offers: [
    { sport: 'surf', level: 'beginner', title: 'Cours débutant', hourlyRate: 45 },
    { sport: 'surf', level: 'advanced', title: 'Cours perf', hourlyRate: 60 },
    { sport: 'kitesurf', level: 'intermediate', title: 'Initiation kite', hourlyRate: 70 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProPublicProfilePage', () => {
  it('calls notFound() when the profile does not exist', async () => {
    mockLoadProfile.mockResolvedValue(null);
    await expect(
      ProPublicProfilePage({ params: Promise.resolve({ slug: 'inconnu' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('renders business name, city, bio and verified badge', async () => {
    mockLoadProfile.mockResolvedValue(fullProfile);
    const jsx = await ProPublicProfilePage({ params: Promise.resolve({ slug: 'blob-surf-school' }) });
    render(jsx);

    expect(screen.getByText('Blob Surf School')).toBeInTheDocument();
    expect(screen.getByText('Lacanau')).toBeInTheDocument();
    expect(screen.getByText(/Cours de surf tous niveaux/)).toBeInTheDocument();
    expect(screen.getByText('Diplômé vérifié')).toBeInTheDocument();
  });

  it('groups offers by sport with French labels', async () => {
    mockLoadProfile.mockResolvedValue(fullProfile);
    const jsx = await ProPublicProfilePage({ params: Promise.resolve({ slug: 'blob-surf-school' }) });
    render(jsx);

    expect(screen.getByText('Surf')).toBeInTheDocument();
    expect(screen.getByText('Kitesurf')).toBeInTheDocument();
    expect(screen.getByText('Cours débutant')).toBeInTheDocument();
    expect(screen.getByText('Débutant')).toBeInTheDocument();
    expect(screen.getByText('Confirmé')).toBeInTheDocument();
    expect(screen.getByText('Intermédiaire')).toBeInTheDocument();
    expect(screen.getByText('45 €/h')).toBeInTheDocument();
  });

  it('falls back to an initial avatar and hides the offers block when there are none', async () => {
    mockLoadProfile.mockResolvedValue({ ...fullProfile, photoUrl: null, offers: [] });
    const jsx = await ProPublicProfilePage({ params: Promise.resolve({ slug: 'blob-surf-school' }) });
    render(jsx);

    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('Cours proposés')).not.toBeInTheDocument();
  });

  it('renders a CTA link to register into the matching funnel', async () => {
    mockLoadProfile.mockResolvedValue(fullProfile);
    const jsx = await ProPublicProfilePage({ params: Promise.resolve({ slug: 'blob-surf-school' }) });
    render(jsx);

    const cta = screen.getByRole('link', { name: /demander un cours/i });
    expect(cta).toHaveAttribute('href', '/register?next=/matching');
  });
});

describe('generateMetadata', () => {
  it('returns empty metadata when the profile does not exist', async () => {
    mockLoadProfile.mockResolvedValue(null);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'inconnu' }) });
    expect(metadata).toEqual({});
  });

  it('builds title/description/canonical/OG from the profile', async () => {
    mockLoadProfile.mockResolvedValue(fullProfile);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'blob-surf-school' }) });

    expect(metadata.title).toContain('Blob Surf School');
    expect(metadata.title).toContain('Lacanau');
    expect(metadata.alternates?.canonical).toContain('/pros/blob-surf-school');
    expect(metadata.openGraph?.images).toEqual([
      { url: 'https://cdn.example.com/photo.jpg', alt: 'Blob Surf School' },
    ]);
  });
});
