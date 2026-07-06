/**
 * Tests — page index /pros (annuaire public, Server Component).
 * Couvre : état vide, regroupement par ville, lien pagination, fallback avatar.
 */
import { render, screen } from '@testing-library/react';
import ProsIndexPage from '../page';
import { loadPublicProList } from '@/lib/pros/loadPublicProProfile';

jest.mock('@/lib/pros/loadPublicProProfile', () => ({
  loadPublicProList: jest.fn(),
}));

jest.mock('@/components/home/HomeHeader', () => ({ HomeHeader: () => <header data-testid="home-header" /> }));
jest.mock('@/components/home/HomeFooter', () => ({ HomeFooter: () => <footer data-testid="home-footer" /> }));

const mockLoadList = loadPublicProList as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProsIndexPage', () => {
  it('shows an empty state when there are no published profiles', async () => {
    mockLoadList.mockResolvedValue({ items: [], nextCursor: null });
    const jsx = await ProsIndexPage({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(screen.getByText(/aucun moniteur n'a encore publié/i)).toBeInTheDocument();
  });

  it('groups pros by city and links to their profile page', async () => {
    mockLoadList.mockResolvedValue({
      items: [
        { slug: 'blob-a', businessName: 'Blob A', photoUrl: null, publicCity: 'Lacanau', verified: true },
        { slug: 'blob-b', businessName: 'Blob B', photoUrl: null, publicCity: 'Biarritz', verified: false },
      ],
      nextCursor: null,
    });

    const jsx = await ProsIndexPage({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(screen.getByText('Lacanau')).toBeInTheDocument();
    expect(screen.getByText('Biarritz')).toBeInTheDocument();
    const link = screen.getByText('Blob A').closest('a');
    expect(link).toHaveAttribute('href', '/pros/blob-a');
    expect(screen.getByText('Diplômé vérifié')).toBeInTheDocument();
  });

  it('falls back to an initial avatar when there is no photo', async () => {
    mockLoadList.mockResolvedValue({
      items: [{ slug: 'blob-a', businessName: 'Blob A', photoUrl: null, publicCity: null, verified: false }],
      nextCursor: null,
    });

    const jsx = await ProsIndexPage({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Autres villes')).toBeInTheDocument();
  });

  it('renders a "Voir plus" link with the next cursor', async () => {
    mockLoadList.mockResolvedValue({
      items: [{ slug: 'blob-a', businessName: 'Blob A', photoUrl: null, publicCity: 'Lacanau', verified: false }],
      nextCursor: 'blob-a',
    });

    const jsx = await ProsIndexPage({ searchParams: Promise.resolve({}) });
    render(jsx);

    const more = screen.getByRole('link', { name: /voir plus/i });
    expect(more).toHaveAttribute('href', '/pros?cursor=blob-a');
  });

  it('forwards the cursor search param to loadPublicProList', async () => {
    mockLoadList.mockResolvedValue({ items: [], nextCursor: null });
    await ProsIndexPage({ searchParams: Promise.resolve({ cursor: 'page-2' }) });

    expect(mockLoadList).toHaveBeenCalledWith('page-2');
  });
});
