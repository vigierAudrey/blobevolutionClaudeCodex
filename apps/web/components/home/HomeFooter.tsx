import Image from 'next/image';
import Link from 'next/link';

const footerColumns = [
  {
    label: 'Plateforme',
    links: [
      { label: 'Matching', href: '/register?intent=matching' },
      { label: 'Cours', href: '/register?intent=lesson-request' },
      { label: 'Guides', href: '/blobosphere' },
    ],
  },
  {
    label: 'Communauté',
    links: [
      { label: 'Rejoindre la communauté', href: '/register' },
      { label: 'Je suis rider', href: '/register?intent=matching' },
      { label: 'Je suis pro', href: '/register?intent=pro' },
    ],
  },
  {
    label: 'À propos',
    links: [
      { label: 'Pourquoi Blob ?', href: '/#why-blob' },
      { label: 'Se connecter', href: '/login' },
    ],
  },
] as const;

/*
 * HomeFooter — footer premium fond noir, Server Component.
 * Full-bleed via marges négatives + annule le py-bottom du main (-mb-6 sm:-mb-10).
 * role="contentinfo" explicite car imbriqué dans <main> (pas de rôle implicite).
 */
export function HomeFooter() {
  return (
    <footer
      role="contentinfo"
      aria-label="Pied de page Blob"
      className="-mx-4 sm:-mx-6 lg:-mx-8 -mb-6 sm:-mb-10"
    >
      <div className="bg-blob-black px-4 sm:px-6 lg:px-10 xl:px-14 pt-12 sm:pt-14 pb-8 sm:pb-10">

        {/* Grille principale : colonnes + identité */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-6">

          {/* Colonnes de liens */}
          {footerColumns.map((col) => (
            <div key={col.label} className="space-y-4">
              <p className="text-white/75 text-[10px] font-black uppercase tracking-[0.2em]">
                {col.label}
              </p>
              <ul className="space-y-2.5" role="list">
                {col.links.map((link) => (
                  <li key={`${col.label}-${link.href}`}>
                    <Link
                      href={link.href}
                      className="text-white/60 text-[13px] leading-snug hover:text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blob-yellow rounded-sm"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Identité */}
          <div className="col-span-2 md:col-span-1 space-y-4 md:text-right">
            <Link
              href="/"
              aria-label="Blob — Retour à l'accueil"
              className="inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow rounded-sm"
            >
              <Image
                src="/images/brand/blob-wordmark-yellow-white-details-transparent-shadow.png"
                alt="Blob"
                width={575}
                height={268}
                className="h-auto w-[82px] sm:w-[92px] opacity-95 hover:opacity-100 transition-opacity duration-200 md:ml-auto"
                sizes="(min-width: 640px) 92px, 82px"
              />
            </Link>
            <p className="text-white/60 text-[11px] leading-relaxed uppercase tracking-[0.14em]">
              Surf &amp; kite community
              <br />
              Médoc Atlantique
            </p>
          </div>

        </div>

        {/* Séparateur + mention légale */}
        <div className="mt-10 pt-6 border-t border-white/[0.07] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-white/20 text-[11px]">
            © 2024–2026 Blob — Bêta locale Médoc Atlantique
          </p>
          <nav aria-label="Liens légaux" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href="/terms"
              className="text-white/40 text-[11px] hover:text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blob-yellow rounded-sm"
            >
              CGU
            </Link>
            <Link
              href="/docs/rgpd"
              className="text-white/40 text-[11px] hover:text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blob-yellow rounded-sm"
            >
              Confidentialité &amp; RGPD
            </Link>
            <Link
              href="/about"
              className="text-white/40 text-[11px] hover:text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blob-yellow rounded-sm"
            >
              À propos
            </Link>
          </nav>
          <p className="text-white/15 text-[10px] uppercase tracking-widest">
            Inscription gratuite, sans engagement
          </p>
        </div>

      </div>
    </footer>
  );
}
