import { render, screen } from '@testing-library/react';
import Home from '../page';

describe('Static Home page', () => {
  it('affiche un hero clair pour la communauté Surf & Kite avec CTA principaux', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /communauté surf & kite/i })).toBeInTheDocument();

    const createAccount = screen.getByRole('link', { name: /Créer un compte/i });
    expect(createAccount).toBeInTheDocument();
  });

  it('met en avant deux circuits avec CTAs explicites', () => {
    render(<Home />);

    // Circuits
    expect(screen.getByRole('heading', { name: /Ride à deux/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Avec un pro/i })).toBeInTheDocument();

    // CTAs circuits → redirigent vers inscription
    expect(screen.getByRole('link', { name: /Commencer le matching/i })).toHaveAttribute('href', expect.stringContaining('/register'));
    expect(screen.getByRole('link', { name: /Publier ma demande/i })).toHaveAttribute('href', expect.stringContaining('/register'));
    expect(screen.getByRole('link', { name: /Voir les offres autour de moi/i })).toHaveAttribute('href', expect.stringContaining('/register'));
  });

  it('affiche les Bons plans et la Blobosphère', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /Voir les bons plans/i })).toHaveAttribute('href', '/promos');
    expect(screen.getByRole('link', { name: /Explorer/i })).toHaveAttribute('href', '/blobosphere');
  });
});
