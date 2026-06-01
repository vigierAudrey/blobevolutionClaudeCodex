import { render, screen } from '@testing-library/react';
import { SafeMdxContent, __safeMdxTestUtils } from '../SafeMdxContent';

describe('SafeMdxContent', () => {
  it('renders markdown without executing raw HTML', () => {
    render(
      <SafeMdxContent
        articleSlug="article"
        content={'# Titre\n\n<script>alert("xss")</script>\n\nTexte **important**.'}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Titre' })).toBeInTheDocument();
    expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument();
    expect(screen.getByText('important')).toBeInTheDocument();
  });

  it('protects external links opened in a new tab', () => {
    render(
      <SafeMdxContent
        articleSlug="article"
        content={'Lien [externe](https://example.com) et [dangereux](javascript:alert(1)).'}
      />,
    );

    const external = screen.getByRole('link', { name: 'externe' });
    expect(external).toHaveAttribute('href', 'https://example.com/');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noreferrer');
    expect(screen.queryByRole('link', { name: 'dangereux' })).not.toBeInTheDocument();
  });

  it('rejects unsafe href protocols at parser level', () => {
    expect(__safeMdxTestUtils.sanitizeHref('javascript:alert(1)')).toBeNull();
    expect(__safeMdxTestUtils.sanitizeHref('/blobosphere')).toBe('/blobosphere');
  });
});

