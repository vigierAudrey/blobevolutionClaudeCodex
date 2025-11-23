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
      'Ouvre /admin (Decap CMS), connecte‑toi et ajoute un fichier MDX dans la rubrique voulue. Le contenu est stocké en Git.',
  },
  {
    question: 'Comment sont gérés SEO et maillage ?',
    answer:
      'Chaque article possède un frontmatter (titre, résumé, tags) et est intégré avec JSON‑LD. Les liens internes renforcent la découverte.',
  },
  {
    question: 'Puis‑je proposer un sujet ? ',
    answer:
      'Oui, crée un compte puis utilise le bouton « Proposer un sujet ». La publication suit une relecture et les règles RGPD.',
  },
] as const;

export const blobosphereInsights = [
  { title: 'MDX + Git', detail: 'Historique clair, PR, relectures, rollback.' },
  { title: 'Decap CMS', detail: 'Edition simple des MDX sans toucher au code.' },
  { title: 'JSON‑LD + liens', detail: 'Visibilité SEO, maillage thématique vers les parcours clés.' },
] as const;

