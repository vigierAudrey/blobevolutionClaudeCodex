export const blobosphereTopics = [
  { slug: 'surf', label: 'Surf • Équipement', icon: '🏄', description: 'Planches, dérives, combinaisons, réglages.' },
  { slug: 'kitesurf', label: 'Kitesurf • Matos', icon: '🪁', description: 'Ailes, boards, barres, sécurité.' },
  { slug: 'communaute', label: 'Communauté', icon: '🤝', description: 'Inclusion, récits, mentoring, organisation.' },
  { slug: 'impact', label: 'Impact & éco', icon: '🌱', description: 'Environnement, sécurité, sobriété sur les spots.' },
] as const;

export type BlobosphereTopicSlug = (typeof blobosphereTopics)[number]['slug'];

export const blobosphereFaqs = [
  {
    question: 'Comment ajouter un article ?',
    answer:
      "L’édition est réservée aux membres autorisés. Connecte‑toi puis demande l’accès rédaction. Les contenus sont des fichiers MDX versionnés dans Git (via Decap CMS).",
  },
  {
    question: 'Comment sont gérés SEO et maillage ?',
    answer:
      'Chaque article possède un frontmatter (titre, résumé, tags) et est intégré avec JSON‑LD. Les liens internes renforcent la découverte.',
  },
  {
    question: 'Puis‑je proposer un sujet ? ',
    answer:
      "Oui, une fois connecté. Les propositions passent par une modération (relecture, RGPD) avant publication. L’accès et les formulaires ne sont disponibles qu’aux membres authentifiés.",
  },
] as const;

export const blobosphereInsights = [
  { title: 'MDX + Git', detail: 'Historique clair, PR, relectures, rollback.' },
  { title: 'Decap CMS', detail: 'Edition simple des MDX sans toucher au code.' },
  { title: 'JSON‑LD + liens', detail: 'Visibilité SEO, maillage thématique vers les parcours clés.' },
] as const;
