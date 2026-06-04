import { render, screen, within } from '@testing-library/react';
import Home from '../page';

function getLinksByHref(container: HTMLElement, href: string) {
  return within(container)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href') === href);
}

function expectLinkWithHref(container: HTMLElement, name: RegExp, href: string) {
  expect(within(container).getByRole('link', { name })).toHaveAttribute('href', href);
}

describe('Static Home page', () => {
  it('affiche le logo Blob et la navigation premium', () => {
    render(<Home />);

    const header = screen.getByRole('banner', { name: /en-tête du site/i });

    expect(
      within(header).getByRole('link', { name: /blob.*retour à l'accueil/i }),
    ).toHaveAttribute('href', '/');
    expect(within(header).getByAltText('Blob')).toBeInTheDocument();

    expectLinkWithHref(header, /Matching/i, '/matching');
    expectLinkWithHref(header, /Cours/i, '/lesson-request');
    expectLinkWithHref(header, /Bons plans/i, '/promos');
    expectLinkWithHref(header, /Guides/i, '/blobosphere');
    expectLinkWithHref(header, /Se connecter/i, '/login');
    expectLinkWithHref(header, /Rejoindre la communauté/i, '/register');
  });

  it('a un H1 sémantique et mentionne la communauté surf & kite', () => {
    render(<Home />);

    // H1 unique et explicite — critique SEO
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveTextContent(/surf.*kite/i);

    // La mention surf & kite dans le Médoc Atlantique reste présente (brand + SEO)
    expect(screen.getAllByText(/communauté surf.*kite.*Médoc Atlantique/i).length).toBeGreaterThan(0);
  });

  it('affiche le hero split et ses CTA principaux', () => {
    render(<Home />);

    const hero = screen.getByRole('region', {
      name: /Blob.*communauté surf.*kite.*Médoc Atlantique/i,
    });

    expect(hero).toHaveTextContent(/la communauté/i);
    expect(hero).toHaveTextContent(/surf & kite/i);
    expect(hero).toHaveTextContent(/du Médoc Atlantique/i);

    expectLinkWithHref(hero, /Je suis rider/i, '/register?intent=matching');
    expectLinkWithHref(hero, /Je suis pro/i, '/register?intent=pro');
  });

  it('affiche la section "Blob te connecte" avec les 3 cartes communauté', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /Blob te connecte/i })).toBeInTheDocument();
    expect(screen.getByText(/Exprime ton envie/i)).toBeInTheDocument();
    expect(screen.getByText(/Rencontre les bons profils/i)).toBeInTheDocument();
    expect(screen.getByText(/Ride en communauté/i)).toBeInTheDocument();
  });

  it('relie les cartes éditoriales et la barre jaune aux parcours clés', () => {
    render(<Home />);

    const hero = screen.getByRole('region', {
      name: /Blob.*communauté surf.*kite.*Médoc Atlantique/i,
    });
    const quickAccess = screen.getByRole('region', {
      name: /Accès rapide aux fonctionnalités Blob/i,
    });

    const expectedHrefs = [
      '/register?intent=matching',
      '/register?intent=lesson-request',
      '/promos',
      '/blobosphere',
    ];

    for (const href of expectedHrefs) {
      expect(getLinksByHref(hero, href).length).toBeGreaterThan(0);
      expect(getLinksByHref(quickAccess, href).length).toBeGreaterThan(0);
    }
  });

  it('affiche la section "Pourquoi Blob ?" avec la brand story', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /Pourquoi Blob/i })).toBeInTheDocument();
    // Copy validée : communauté surf & kite vivante dans le Médoc
    expect(screen.getAllByText(/communauté surf.*kite.*Médoc Atlantique/i).length).toBeGreaterThan(0);
    // Esprit glisse préservé dans la brand story
    expect(screen.getAllByText(/esprit glisse/i).length).toBeGreaterThan(0);
  });
});
