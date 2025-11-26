export const blobosphereTopics = [
  { slug: 'surf', label: 'Surf', icon: '🏄', description: 'Equipements, conseils pour débuter, conditions...' },
  { slug: 'kitesurf', label: 'Kitesurf', icon: '🪁', description: 'Matériel, tutos, sécurité...' },
  { slug: 'communaute', label: 'Communauté', icon: '🤝', description: 'Interview, initiatives inspirantes, le respect sur les spots' },
  { slug: 'impact', label: 'Impact & éco', icon: '🌱', description: 'Environnement, protection, économies...' },
] as const;

export type BlobosphereTopicSlug = (typeof blobosphereTopics)[number]['slug'];
