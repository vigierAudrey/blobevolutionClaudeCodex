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
  cta: string;
  href: string;
  scheme: 'blue' | 'emerald';
};

const CONTENT: Record<HighlightContext, HighlightContent> = {
  matching: {
    badge: 'Communauté Blob',
    title: 'Des riders attendent de rider avec toi',
    body: 'Trouve des riders qui partagent ton niveau et tes envies de session dans le Médoc Atlantique.',
    cta: 'Rejoindre la communauté',
    href: '/register?intent=matching',
    scheme: 'blue',
  },
  'matching-end': {
    badge: 'Communauté Blob',
    title: 'La communauté grandit',
    body: 'De nouveaux riders rejoignent Blob dans le Médoc Atlantique. Repasse dans quelques jours ou élargis ta zone.',
    cta: 'Explorer la Blobosphère',
    href: '/blobosphere',
    scheme: 'blue',
  },
  home: {
    badge: 'Partenaires fondateurs',
    title: 'Pros du Médoc Atlantique',
    body: 'Écoles, moniteurs, shops et assos qui construisent Blob dans le Médoc Atlantique.',
    cta: 'Rejoindre les premiers pros',
    href: '/register?intent=pro',
    scheme: 'emerald',
  },
  blobosphere: {
    badge: 'Communauté Blob',
    title: 'Trouve ton binôme de session',
    body: 'Trouve des riders qui partagent ton niveau et tes envies de session.',
    cta: 'Commencer le matching',
    href: '/register?intent=matching',
    scheme: 'blue',
  },
  dashboard: {
    badge: 'Partenaires fondateurs',
    title: 'Pros du Médoc Atlantique',
    body: 'Écoles, moniteurs, shops et assos qui construisent Blob dans le Médoc Atlantique.',
    cta: 'Rejoindre les premiers pros',
    href: '/register?intent=pro',
    scheme: 'emerald',
  },
};

export function CommunityHighlight({ context = 'home', className = '' }: CommunityHighlightProps) {
  const content = CONTENT[context];
  const isBlue = content.scheme === 'blue';

  return (
    <div
      className={`rounded-2xl border px-6 py-5 ${
        isBlue
          ? 'border-blue-200/60 bg-gradient-to-br from-blue-50 to-cyan-50 dark:border-blue-800/40 dark:from-blue-950/30 dark:to-cyan-950/20'
          : 'border-emerald-200/60 bg-gradient-to-br from-emerald-50 to-teal-50 dark:border-emerald-800/40 dark:from-emerald-950/30 dark:to-teal-950/20'
      } ${className}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${isBlue ? 'bg-blue-500' : 'bg-emerald-500'}`} />
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                isBlue ? 'text-blue-700 dark:text-blue-400' : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {content.badge}
            </span>
          </div>
          <p className="font-semibold text-slate-800 dark:text-slate-100">{content.title}</p>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{content.body}</p>
        </div>
        <Link
          href={content.href}
          className={`inline-flex flex-none items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white shadow-sm transition active:scale-95 ${
            isBlue ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {content.cta}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
