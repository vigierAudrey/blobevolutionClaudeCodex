import Image from 'next/image';
import Link from 'next/link';
import { BlobButton } from '@/components/blob/BlobButton';

const navLinks = [
  { href: '/register?intent=matching', label: 'Matching' },
  { href: '/register?intent=lesson-request', label: 'Cours' },
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
        /* Pull the hero underneath the header, matching the visual target overlay */
        '-mb-[70px] sm:-mb-[80px] lg:-mb-[86px]',
        /* Sticky */
        'sticky top-0 z-50',
        /* Visual */
        'bg-[linear-gradient(90deg,rgba(14,16,18,0.90)_0%,rgba(18,18,16,0.78)_55%,rgba(28,25,18,0.66)_100%)] backdrop-blur-sm',
        'border-b border-white/12 shadow-[0_8px_24px_rgba(0,0,0,0.28)]',
      ].join(' ')}
      aria-label="En-tête du site"
    >
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-10 xl:px-14 py-3">

        {/* Logo */}
        <Link
          href="/"
          aria-label="Blob — Retour à l'accueil"
          className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-blob-black rounded-sm"
        >
          <Image
            src="/images/brand/blob-wordmark-yellow-white-details-transparent-shadow.png"
            alt="Blob"
            width={575}
            height={268}
            priority
            className="h-auto w-[96px] sm:w-[118px] lg:w-[132px]"
            sizes="(min-width: 1024px) 132px, (min-width: 640px) 118px, 96px"
          />
        </Link>

        {/* Navigation — desktop uniquement */}
        <nav aria-label="Navigation principale" className="hidden md:block flex-1 mx-4 lg:mx-8">
          <ul className="flex items-center gap-5 lg:gap-7" role="list">
            {navLinks.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-white/90 text-[11px] font-bold uppercase tracking-[0.12em] drop-shadow-[0_1px_8px_rgba(0,0,0,0.55)] hover:text-blob-yellow transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow rounded-sm py-1"
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
            className="hidden sm:inline-flex min-h-9 items-center border border-white/45 bg-blob-black/22 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white hover:border-blob-yellow hover:text-blob-yellow transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow rounded-sm whitespace-nowrap"
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
