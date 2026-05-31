import Link from 'next/link';

type SpotlightVariant = 'partners' | 'community';

interface CommunitySpotlightProps {
  variant?: SpotlightVariant;
  className?: string;
}

export function CommunitySpotlight({ variant = 'partners', className = '' }: CommunitySpotlightProps) {
  if (variant === 'community') {
    return (
      <div
        className={`flex flex-col gap-4 rounded-2xl border border-blue-200/60 bg-gradient-to-b from-blue-50 to-cyan-50 p-5 dark:border-blue-800/40 dark:from-blue-950/30 dark:to-cyan-950/20 ${className}`}
      >
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400">
            Communauté Blob
          </span>
        </div>
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          Trouve des riders qui partagent ton niveau et tes envies de session.
        </p>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Bordeaux · Médoc Atlantique
        </p>
        <Link
          href="/register?intent=matching"
          className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
        >
          Rejoindre
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-4 rounded-2xl border border-emerald-200/60 bg-gradient-to-b from-emerald-50 to-teal-50 p-5 dark:border-emerald-800/40 dark:from-emerald-950/30 dark:to-teal-950/20 ${className}`}
    >
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Partenaires fondateurs
        </span>
      </div>
      <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        Écoles, moniteurs, shops et assos qui construisent Blob dans le Médoc Atlantique.
      </p>
      <Link
        href="/register?intent=pro"
        className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
      >
        Rejoindre les premiers pros
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
