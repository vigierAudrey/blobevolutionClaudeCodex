import Image from 'next/image';
import Link from 'next/link';
import { BlobButton } from '@/components/blob/BlobButton';

const navLinks = [
  { href: '/matching', label: 'Matching' },
  { href: '/lesson-request', label: 'Cours' },
  { href: '/promos', label: 'Bons plans' },
  { href: '/blobosphere', label: 'Guides' },
  { href: '/#why-blob', label: 'À propos' },
] as const;

/*
 * HomeHeader — header premium horizontal, Server Component.
 *
 * Brise out du container via -mx / -mt négatifs pour couvrir toute la largeur.
 * Sticky : colle en haut du viewport au scroll.
 * Mobile : nav masquée (aucun hamburger JS requis), logo + CTA conservés.
 */
export function HomeHeader() {
  return (
    <header
      className={[
        /* Break out of container-responsive horizontal padding */
        '-mx-4 sm:-mx-6 lg:-mx-8',
        /* Cancel container py-6 / sm:py-10 top padding so header touches viewport top */
        '-mt-6 sm:-mt-10',
        /* Sticky */
        'sticky top-0 z-50',
        /* Visual */
        'bg-blob-black/96 backdrop-blur-md',
        'border-b border-white/[0.08]',
      ].join(' ')}
      aria-label="En-tête du site"
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-10 xl:px-14 py-3.5">

        {/* Logo */}
        <Link
          href="/"
          aria-label="Blob — Retour à l'accueil"
          className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-blob-black rounded-sm"
        >
          <Image
            src="/images/brand/blob-wordmark.webp"
            alt="Blob"
            width={120}
            height={56}
            priority
            className="w-[76px] sm:w-[90px] lg:w-[100px]"
            sizes="100px"
          />
        </Link>

        {/* Navigation — desktop uniquement */}
        <nav aria-label="Navigation principale" className="hidden md:block flex-1 mx-4 lg:mx-8">
          <ul className="flex items-center gap-5 lg:gap-7" role="list">
            {navLinks.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-white/70 text-[11px] font-bold uppercase tracking-[0.12em] hover:text-blob-yellow transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow rounded-sm py-1"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Auth actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            href="/login"
            className="hidden sm:inline-block text-[11px] font-bold uppercase tracking-[0.12em] text-white/65 hover:text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow rounded-sm px-2 py-1 whitespace-nowrap"
          >
            Se connecter
          </Link>
          <BlobButton asChild variant="primaryYellow" size="sm">
            <Link href="/register" className="whitespace-nowrap">
              <span className="hidden sm:inline">Rejoindre la communauté</span>
              <span className="sm:hidden">Rejoindre</span>
            </Link>
          </BlobButton>
        </div>

      </div>
    </header>
  );
}
