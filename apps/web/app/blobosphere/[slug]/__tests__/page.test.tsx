import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import BlobosphereArticlePage, { generateMetadata } from '../page';
import { loadPublishedBlobosphereArticleBySlug } from '@/lib/blobosphere/loadBlobosphereArticle';

type MockImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
};

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt = '', fill: _fill, priority: _priority, sizes: _sizes, ...props }: MockImageProps) => <img alt={alt} {...props} />,
}));

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

jest.mock('@/lib/blobosphere/loadBlobosphereArticle', () => ({
  loadPublishedBlobosphereArticleBySlug: jest.fn(),
}));

jest.mock('@/lib/blobosphere/loadBlobosphereSitemapEntries', () => ({
  loadBlobosphereSitemapEntries: jest.fn().mockResolvedValue([{ slug: 'article-publie' }]),
}));

const mockLoadArticle = loadPublishedBlobosphereArticleBySlug as jest.MockedFunction<typeof loadPublishedBlobosphereArticleBySlug>;

describe('/blobosphere/[slug]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadArticle.mockResolvedValue({
      slug: 'article-publie',
      title: 'Article publié',
      excerpt: 'Un guide publié pour la communauté.',
      category: 'surf',
      publishedAt: '2025-01-10',
      updatedAt: null,
      readingTime: '2 min',
      tags: ['surf'],
      coverImage: '/images/blobosphere/placeholder-surf.jpg',
      body: '# Bien débuter\n\nContenu **utile** avec [un lien](https://example.com).',
    });
  });

  it('renders a published article', async () => {
    render(await BlobosphereArticlePage({ params: Promise.resolve({ slug: 'article-publie' }) }));

    expect(screen.getByRole('heading', { name: 'Article publié' })).toBeInTheDocument();
    expect(screen.getByText('Un guide publié pour la communauté.')).toBeInTheDocument();
    expect(screen.getAllByText('Surf').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Bien débuter' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Retour à la Blobosphère' })[0]).toHaveAttribute('href', '/blobosphere');
  });

  it('generates article metadata', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'article-publie' }) });

    expect(metadata.title).toBe('Article publié · Blobosphère');
    expect(metadata.description).toBe('Un guide publié pour la communauté.');
    expect(metadata.alternates).toEqual({ canonical: 'http://localhost:3002/blobosphere/article-publie' });
  });

  it('calls notFound for unknown or non-public slugs', async () => {
    mockLoadArticle.mockResolvedValueOnce(null);

    await expect(BlobosphereArticlePage({ params: Promise.resolve({ slug: 'brouillon' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
