import { render, screen } from '@testing-library/react';
import BlobospherePage from '../page';
import { loadBlobospherePreviews } from '@/lib/blobosphere/loadBlobospherePreviews';

type MockImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
};

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt = '', fill: _fill, priority: _priority, sizes: _sizes, ...props }: MockImageProps) => <img alt={alt} {...props} />,
}));

jest.mock('@/lib/blobosphere/loadBlobospherePreviews', () => ({
  loadBlobospherePreviews: jest.fn(),
}));

jest.mock('@/components/blobosphere/BlobosphereAnalyticsLink', () => ({
  BlobosphereArticleLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  BlobosphereSignupLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

jest.mock('@/components/community/CommunitySpotlight', () => ({
  CommunitySpotlight: () => null,
}));

jest.mock('@/components/community/CommunityHighlight', () => ({
  CommunityHighlight: () => null,
}));

const mockLoadPreviews = loadBlobospherePreviews as jest.MockedFunction<typeof loadBlobospherePreviews>;

describe('/blobosphere', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadPreviews.mockResolvedValue([
      {
        slug: 'article-publie',
        title: 'Article publié',
        excerpt: 'Extrait publié',
        topic: 'surf',
        readingTime: '2 min',
        publishedAt: '2025-01-10',
        tags: ['surf'],
      },
    ]);
  });

  it('lists published articles returned by the public loader', async () => {
    render(await BlobospherePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Article publié' })).toBeInTheDocument();
    expect(screen.getByText('Extrait publié')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lire l'article/i })).toHaveAttribute('href', '/blobosphere/article-publie');
  });

  it('filters by topic without client fetch', async () => {
    render(await BlobospherePage({ searchParams: Promise.resolve({ topic: 'kitesurf' }) }));

    expect(screen.queryByRole('heading', { name: 'Article publié' })).not.toBeInTheDocument();
    expect(screen.getByText(/Aucun article publié pour cette rubrique/i)).toBeInTheDocument();
  });
});
