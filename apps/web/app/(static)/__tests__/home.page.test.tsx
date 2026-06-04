import { render, screen } from '@testing-library/react';
import Home from '../page';

describe('Static Home page', () => {
  it('a un H1 sémantique et mentionne la communauté surf & kite', () => {
    render(<Home />);

    // H1 unique et explicite — critique SEO
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveTextContent(/surf.*kite/i);

    // La mention surf & kite dans le Médoc Atlantique reste présente (brand + SEO)
    expect(screen.getAllByText(/communauté surf.*kite.*Médoc Atlantique/i).length).toBeGreaterThan(0);
  });

  it('affiche les CTA principaux dans le hero', () => {
    render(<Home />);

    const riderCta = screen.getByRole('link', { name: /Je suis rider/i });
    expect(riderCta).toBeInTheDocument();

    const proCta = screen.getByRole('link', { name: /Je suis pro/i });
    expect(proCta).toBeInTheDocument();
  });

  it('affiche la section "Blob te connecte" avec les 3 cartes communauté', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /Blob te connecte/i })).toBeInTheDocument();
    expect(screen.getByText(/Exprime ton envie/i)).toBeInTheDocument();
    expect(screen.getByText(/Rencontre les bons profils/i)).toBeInTheDocument();
    expect(screen.getByText(/Ride en communauté/i)).toBeInTheDocument();
  });

  it('affiche le texte CTA principal et la mention bêta', () => {
    render(<Home />);

    // CTA direct, sans tiret long
    expect(screen.getAllByText(/trouve les bonnes personnes.*sessions/i).length).toBeGreaterThan(0);
    // Mention bêta visible et discrète
    expect(screen.getAllByText(/Compte gratuit.*B.ta locale/i).length).toBeGreaterThan(0);
  });

  it('affiche la section "Pourquoi Blob ?" avec la brand story', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /Pourquoi Blob/i })).toBeInTheDocument();
    // Copy validée : communauté surf & kite vivante dans le Médoc
    expect(screen.getAllByText(/communauté surf.*kite.*Médoc Atlantique/i).length).toBeGreaterThan(0);
    // Esprit glisse préservé dans la brand story
    expect(screen.getAllByText(/esprit glisse/i).length).toBeGreaterThan(0);
  });

  it('met en avant deux circuits avec CTAs explicites', () => {
    render(<Home />);

    // Circuits - Use getAllByRole to handle multiple matches from carousel + circuits
    const rideHeadings = screen.getAllByRole('heading', { name: /Ride à deux/i });
    expect(rideHeadings.length).toBeGreaterThan(0);

    const proHeadings = screen.getAllByRole('heading', { name: /Avec un pro/i });
    expect(proHeadings.length).toBeGreaterThan(0);

    // CTAs circuits → redirigent vers inscription
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
