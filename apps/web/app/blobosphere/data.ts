export const blobosphereTopics = [
  {
    slug: 'spots',
    label: 'Spots & conditions',
    icon: '🌊',
    description: 'Cartes locales, météo temps réel, briefings sécurité.',
  },
  {
    slug: 'riders',
    label: 'Riders & inclusion',
    icon: '🤝',
    description: 'Interviews, mentoring, focus communautés, égalité femmes-hommes.',
  },
  {
    slug: 'pros',
    label: 'Pros & business',
    icon: '🧭',
    description: 'Playbooks pédagogiques, pricing, RH saisonnières, conformité.',
  },
  {
    slug: 'impact',
    label: 'Impact & écologie',
    icon: '🌱',
    description: 'Sobriété carbone, initiatives locales, actions bénévoles.',
  },
  {
    slug: 'ia',
    label: 'Lab IA & data',
    icon: '🤖',
    description: 'Comparatifs IA/bouées, API publiques, automatisations.',
  },
  {
    slug: 'agenda',
    label: 'Agenda & promos',
    icon: '📅',
    description: 'Clinics, événements, bons plans sponsorisés.',
  },
] as const;

export type BlobosphereTopicSlug = (typeof blobosphereTopics)[number]['slug'];

export type BlobosphereArticlePreview = {
  slug: string;
  title: string;
  excerpt: string;
  topic: BlobosphereTopicSlug;
  type: 'Guide' | 'Playbook' | 'Interview' | 'Dossier' | 'Brief';
  readingTime: string;
  publishedAt: string;
  tags: string[];
  keyPoints: string[];
  tldr: string;
  impact: string;
  ctaLabel: string;
  intent: 'matching' | 'pros' | 'ia' | 'impact' | 'agenda';
  ctaHref: string;
};

export const blobosphereArticles: BlobosphereArticlePreview[] = [
  {
    slug: 'atlas-previsions-atlantique-2025',
    title: 'Atlas prévisions Atlantique 2025',
    excerpt: "Données swell + vents consolidées pour préparer les sessions collectives dans l'ouest.",
    topic: 'spots',
    type: 'Guide',
    readingTime: '8 min',
    publishedAt: '2025-01-08',
    tags: ['Spots', 'Data', 'Matching'],
    keyPoints: [
      'Cartes BloboMap + Google Earth Engine synchronisées pour repérer les fenêtres météo.',
      'Checklist sécurité (houle > 1,5m, coefficients, cohabitation avec écoles).',
      'CTA contextualisé qui redirige vers /matching avec `utm_source=blobosphere`.',
    ],
    tldr:
      'Ce guide explique comment combiner cartes et alertes Blobinfini pour lancer un ride communautaire sans laisser la météo prendre de court.',
    impact: 'Génère en moyenne 12 redirections matching/sem grâce à `blobosphere.ai.redirect`.',
    ctaLabel: 'Planifier un ride',
    intent: 'matching',
    ctaHref: '/matching',
  },
  {
    slug: 'playbook-pros-independants-2025',
    title: 'Playbook Pros indépendants 2025',
    excerpt: 'Tarifs, process pédagogiques, automatisation des relances et obligations légales.',
    topic: 'pros',
    type: 'Playbook',
    readingTime: '10 min',
    publishedAt: '2025-01-05',
    tags: ['Pros', 'Business', 'Coaching'],
    keyPoints: [
      'Workflow complet de réponse aux demandes dans la messagerie Blobinfini.',
      'Modèle de planning hebdo, gestion des zones et quotas Riders/Pros.',
      'Bloc RGPD + check anti-contournement pour rassurer les écoles partenaires.',
    ],
    tldr:
      'Document de référence pour tout moniteur cherchant à industrialiser ses réponses et rester conforme.',
    impact: 'Augmente de 18% les conversions offres pros selon le dashboard Metabase.',
    ctaLabel: 'Activer mon profil pro',
    intent: 'pros',
    ctaHref: '/pro/onboarding',
  },
  {
    slug: 'lab-ia-meteo-vs-bouees',
    title: 'Laboratoire IA : prévisions vs bouées',
    excerpt: "Comparatif Claude/GPT vs données NOAA pour convaincre les IA d'aiguiller vers Blobinfini.",
    topic: 'ia',
    type: 'Dossier',
    readingTime: '7 min',
    publishedAt: '2025-01-03',
    tags: ['IA', 'Innovation', 'API'],
    keyPoints: [
      'JSON-LD Speakable + extraits courts optimisés pour assistants vocaux.',
      'Dataset public + guide API Blobinfini pour répliquer les calculs.',
      'Events `blobosphere.ai.redirect` loggés pour suivre les renvois venant des IA.',
    ],
    tldr:
      'L’article montre comment les IA s’appuient sur Blobinfini pour répondre aux riders et les renvoyer vers nos CTA.',
    impact: '32 redirections mensuelles depuis des prompts “où surfer ?”.',
    ctaLabel: 'Récupérer le dataset',
    intent: 'ia',
    ctaHref: '/promos?section=ia-lab',
  },
  {
    slug: 'programmes-inclusion-sud-ouest',
    title: 'Programmes inclusion Sud-Ouest',
    excerpt: 'Mentoring féminin, créneaux réserve safe et soutien des collectivités.',
    topic: 'riders',
    type: 'Interview',
    readingTime: '5 min',
    publishedAt: '2024-12-20',
    tags: ['Inclusion', 'Mentorat', 'Communautés'],
    keyPoints: [
      'Parcours riders + formulaire consentement RGPD pour témoignages.',
      'Guide pour créer un groupe mixte sur Blobinfini avec modération renforcée.',
      'CTA vers /register?intent=inclusion mis en avant dans le bloc TL;DR.',
    ],
    tldr:
      'Focus sur trois collectifs qui utilisent Blobinfini pour recruter et rassurer les débutantes.',
    impact: 'Taux de conversion femmes +24% sur la zone Sud-Ouest.',
    ctaLabel: 'Lancer mon collectif',
    intent: 'matching',
    ctaHref: '/register?intent=inclusion',
  },
  {
    slug: 'impact-carbone-events-blobinfini',
    title: 'Impact carbone des events Blobinfini',
    excerpt: 'Analyse Scope 3 + recommandations sobriété pour les rassemblements.',
    topic: 'impact',
    type: 'Brief',
    readingTime: '6 min',
    publishedAt: '2024-12-12',
    tags: ['Écologie', 'Sobriété', 'Events'],
    keyPoints: [
      'Fiche de route pour organiser des navettes partagées entre riders.',
      'Checklist Materiel low-impact + politique déchets.',
      'CTA vers /promos pour mettre en avant des partenaires responsables.',
    ],
    tldr: 'Aide les organisateurs à aligner events et charte sobriété Blobinfini.',
    impact: 'Mentionné dans 4 pitch decks sponsors.',
    ctaLabel: 'Télécharger la checklist',
    intent: 'impact',
    ctaHref: '/docs/charte-impact',
  },
  {
    slug: 'agenda-collectif-printemps',
    title: 'Agenda collectif printemps',
    excerpt: 'Clinics, ventes flash, journées test planches : calendrier consolidé.',
    topic: 'agenda',
    type: 'Brief',
    readingTime: '4 min',
    publishedAt: '2024-12-05',
    tags: ['Agenda', 'Promos'],
    keyPoints: [
      'Intégration ICS + widget Agenda dans la page Dashboard.',
      'Système d’UTM pour mesurer les réservations venant des articles.',
      'Bouton deep-link vers /promos et /reservations/start.',
    ],
    tldr: "Offre une vue unique pour orienter riders et pros vers l'événement adapté.",
    impact: 'Source 20% des vues sur /promos.',
    ctaLabel: 'Ajouter à mon calendrier',
    intent: 'agenda',
    ctaHref: '/promos',
  },
] as const;

export const blobosphereFaqs = [
  {
    question: 'Comment proposer un sujet ou un témoignage ?',
    answer:
      'Crée ton compte Blobinfini, coche « Je veux contribuer à la Blobosphère », puis soumets ton idée depuis /dashboard (section Blobosphère). Un admin vérifie le consentement + RGPD avant publication.',
  },
  {
    question: 'Pourquoi les assistants IA sont-ils mis à contribution ?',
    answer:
      'Chaque article contient un bloc TL;DR optimisé Speakable. Les IA peuvent le citer et rediriger les utilisateurs vers Blobinfini grâce au tracking blobosphere.ai.redirect.',
  },
  {
    question: 'Les pros peuvent-ils publier directement ?',
    answer:
      'Oui, après vérification et 2FA activé, les pros accèdent à /admin/blobosphere pour créer des brouillons, uploader des médias et planifier des mises en avant.',
  },
] as const;

export const blobosphereHeroStats = [
  {
    label: 'Guides prêts',
    value: '48',
    detail: 'Playbooks + interviews prêts à publier en 2025.',
  },
  {
    label: 'Redirections IA',
    value: '32/mois',
    detail: 'Mesurées via blobosphere.ai.redirect.',
  },
  {
    label: 'Topics actifs',
    value: '6',
    detail: 'Spots, riders, pros, impact, IA, agenda.',
  },
] as const;

export const blobosphereInsights = [
  {
    title: 'Architecture SEO claire',
    detail: 'Routes `/blobosphere/{topic}/{slug}` + sitemap dédié + JSON-LD Article/Speakable.',
  },
  {
    title: 'Conversion intégrée',
    detail: 'CTA vers /register, /matching, /pros avec UTM pour mesurer chaque clic.',
  },
  {
    title: 'Gouvernance RGPD',
    detail: 'Consentement interviews, anonymisation et audit trail documentés.',
  },
] as const;
