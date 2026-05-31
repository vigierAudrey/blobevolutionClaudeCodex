import { render, screen } from '@testing-library/react';
import Home from '../page';

describe('Static Home page', () => {
  it('affiche un hero clair pour la communauté Surf & Kite avec CTA principaux', () => {
    render(<Home />);

    expect(screen.getAllByText(/communauté surf.*kite du Médoc Atlantique/i).length).toBeGreaterThan(0);

    const riderCta = screen.getByRole('link', { name: /Je suis rider/i });
    expect(riderCta).toBeInTheDocument();
  });

  it('met en avant deux circuits avec CTAs explicites', () => {
    render(<Home />);

    // Circuits - Use getAllByRole to handle multiple matches from carousel + circuits
    const rideHeadings = screen.getAllByRole('heading', { name: /Ride à deux/i });
    expect(rideHeadings.length).toBeGreaterThan(0);

    const proHeadings = screen.getAllByRole('heading', { name: /Avec un pro/i });
    expect(proHeadings.length).toBeGreaterThan(0);

    // CTAs circuits → redirigent vers inscription
    // Use getAllByRole since these CTAs may appear in carousel + circuits
    const matchingLinks = screen.getAllByRole('link', { name: /Commencer le matching/i });
    expect(matchingLinks.some(link => link.getAttribute('href')?.includes('/register'))).toBe(true);

    const demandLinks = screen.getAllByRole('link', { name: /Publier ma demande/i });
    expect(demandLinks.some(link => link.getAttribute('href')?.includes('/register'))).toBe(true);

    expect(screen.queryByRole('link', { name: /Voir les offres autour de moi/i })).not.toBeInTheDocument();
  });

  it('affiche les Bons plans et la Blobosphère', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /Voir les bons plans/i })).toHaveAttribute('href', '/promos');
    expect(screen.getByRole('link', { name: /Explorer/i })).toHaveAttribute('href', '/blobosphere');
  });
});
