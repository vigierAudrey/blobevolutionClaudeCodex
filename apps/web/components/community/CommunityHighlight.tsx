import Link from 'next/link';

type HighlightContext = 'matching' | 'matching-end' | 'home' | 'blobosphere' | 'dashboard';

interface CommunityHighlightProps {
  context?: HighlightContext;
  className?: string;
}

type HighlightContent = {
  badge: string;
  title: string;
  body: string;
  cta?: string;
  href?: string;
  scheme: 'dark' | 'sand' | 'yellow';
};

const CONTENT: Record<HighlightContext, HighlightContent> = {
  matching: {
    badge: 'Communauté Blob',
    title: 'Des riders attendent de rider avec toi',
    body: 'Trouve des riders qui partagent ton niveau et tes envies de session dans le Médoc Atlantique.',
    cta: 'Rejoindre la communauté',
    href: '/register?intent=matching',
    scheme: 'dark',
  },
  'matching-end': {
    badge: 'Communauté Blob',
    title: 'La communauté grandit',
    body: 'De nouveaux riders rejoignent Blob dans le Médoc Atlantique. Repasse dans quelques jours ou élargis ta zone.',
    cta: 'Explorer la Blobosphère',
    href: '/blobosphere',
    scheme: 'dark',
  },
  home: {
    badge: 'Partenaires fondateurs',
    title: 'Pros du Médoc Atlantique',
    body: 'Écoles, moniteurs, shops et assos qui construisent Blob dans le Médoc Atlantique.',
    cta: 'Rejoindre les premiers pros',
    href: '/register?intent=pro',
    scheme: 'sand',
  },
  blobosphere: {
    badge: 'Communauté Blob',
    title: 'Trouve ton binôme de session',
    body: 'Trouve des riders qui partagent ton niveau et tes envies de session.',
    cta: 'Commencer le matching',
    href: '/register?intent=matching',
    scheme: 'dark',
  },
  dashboard: {
    badge: 'Partenaires fondateurs',
    title: 'Soutiens le projet Blob',
    body: 'Tu fais partie des premiers riders à construire une communauté locale. Parle-en autour de toi, chaque rider compte.',
    scheme: 'yellow',
  },
};

const schemeStyles = {
  dark: {
    wrap: 'bg-blob-black text-white border-white/10',
    badge: 'text-blob-yellow',
    dot: 'bg-blob-yellow',
    title: 'text-white',
    body: 'text-white/70',
    cta: 'bg-blob-yellow text-blob-black hover:bg-blob-yellow-dark',
  },
  sand: {
    wrap: 'bg-blob-sand dark:bg-[hsl(220_14%_14%)] text-blob-black dark:text-white border-blob-sand-deep dark:border-white/10',
    badge: 'text-blob-black/60 dark:text-white/50',
    dot: 'bg-blob-black dark:bg-white',
    title: 'text-blob-black dark:text-white',
    body: 'text-blob-black/72 dark:text-white/70',
    cta: 'bg-blob-black text-white hover:bg-blob-black/80 dark:bg-white dark:text-blob-black dark:hover:bg-white/90',
  },
  yellow: {
    wrap: 'bg-blob-yellow text-blob-black border-blob-yellow-dark/40',
    badge: 'text-blob-black/60',
    dot: 'bg-blob-black',
    title: 'text-blob-black',
    body: 'text-blob-black/72',
    cta: 'bg-blob-black text-white hover:bg-blob-black/80',
  },
};

export function CommunityHighlight({ context = 'home', className = '' }: CommunityHighlightProps) {
  const content = CONTENT[context];
  const s = schemeStyles[content.scheme];

  return (
    <div className={`rounded-sm border-2 px-6 py-5 ${s.wrap} ${className}`}>
      <div className={`flex flex-col gap-4 ${content.cta ? 'sm:flex-row sm:items-center' : ''}`}>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${s.dot}`} />
            <span className={`text-xs font-black uppercase tracking-widest ${s.badge}`}>
              {content.badge}
            </span>
          </div>
          <p className={`font-black uppercase tracking-widest ${s.title}`}>{content.title}</p>
          <p className={`text-sm leading-relaxed ${s.body}`}>{content.body}</p>
        </div>
        {content.cta && content.href && (
          <Link
            href={content.href}
            className={`inline-flex flex-none items-center justify-center gap-2 rounded-sm border-2 border-transparent px-5 py-2.5 text-sm font-black uppercase tracking-widest shadow-sm transition active:scale-95 ${s.cta}`}
          >
            {content.cta}
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}
