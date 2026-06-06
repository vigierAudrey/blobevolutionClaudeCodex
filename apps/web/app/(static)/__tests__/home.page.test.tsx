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

    // Matching et Cours pointent vers les routes register — pas de page de prévisualisation
    expectLinkWithHref(header, /Matching/i, '/register?intent=matching');
    expectLinkWithHref(header, /Cours/i, '/register?intent=lesson-request');
    expectLinkWithHref(header, /Bons plans/i, '/promos');
    expectLinkWithHref(header, /Guides/i, '/blobosphere');
    expectLinkWithHref(header, /Se connecter/i, '/login');
    expectLinkWithHref(header, /Rejoindre la communauté/i, '/register');
  });

  it('a un H1 sémantique et mentionne surf & kite dans le Médoc', () => {
    render(<Home />);

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveTextContent(/surf.*kite/i);

    // Le Médoc Atlantique est mentionné sur la page (hero, footer, WhyBlob)
    expect(screen.getAllByText(/Médoc Atlantique/i).length).toBeGreaterThan(0);
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

  it('affiche la transition communautaire entre le hero et Pourquoi Blob', () => {
    render(<Home />);

    const transition = screen.getByRole('region', {
      name: /On commence là où la communauté ride déjà/i,
    });

    expect(
      within(transition).getByRole('heading', {
        name: /On commence là où la communauté ride déjà/i,
      }),
    ).toBeInTheDocument();
    expect(within(transition).getByText(/Première zone de test/i)).toBeInTheDocument();
    expect(within(transition).getByText(/Hourtin, Carcans, Lacanau et Bordeaux/i)).toBeInTheDocument();
    expect(within(transition).getByLabelText('HOURTIN • CARCANS • LACANAU • BORDEAUX')).toBeInTheDocument();
  });

  it('affiche la section "Pourquoi Blob ?" avec le messaging bêta', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /Pourquoi Blob/i })).toBeInTheDocument();

    // "bêta locale" apparaît dans le texte et/ou les piliers (plusieurs occurrences possibles)
    expect(screen.getAllByText(/bêta locale/i).length).toBeGreaterThan(0);

    // Piliers attendus (labels de piliers — correspondance partielle)
    expect(screen.getAllByText(/bêta locale/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sans engagement/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Utile pour la communauté/i)).toBeInTheDocument();

    // Ancre #why-blob accessible depuis le header (section id)
    const section = document.getElementById('why-blob');
    expect(section).not.toBeNull();
  });

  it('affiche le footer premium avec les routes sûres', () => {
    render(<Home />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();

    // Logo Blob dans le footer
    expect(within(footer).getByAltText('Blob')).toBeInTheDocument();

    // Routes Plateforme
    expectLinkWithHref(footer, /^Matching$/i, '/register?intent=matching');
    expectLinkWithHref(footer, /^Cours$/i, '/register?intent=lesson-request');
    expectLinkWithHref(footer, /^Bons plans$/i, '/promos');
    expectLinkWithHref(footer, /^Guides$/i, '/blobosphere');

    // Routes Communauté
    expectLinkWithHref(footer, /Rejoindre la communauté/i, '/register');

    // Routes À propos
    expectLinkWithHref(footer, /Pourquoi Blob/i, '/#why-blob');
    expectLinkWithHref(footer, /Se connecter/i, '/login');
  });

  it('ne contient pas de liens vers /matching ou /lesson-request directs', () => {
    render(<Home />);

    const allLinks = screen.getAllByRole('link');
    const deadLinks = allLinks.filter((link) => {
      const href = link.getAttribute('href');
      return href === '/matching' || href === '/lesson-request';
    });
    expect(deadLinks).toHaveLength(0);
  });
});
