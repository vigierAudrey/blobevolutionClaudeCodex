import Image from 'next/image';
import Link from 'next/link';
import { BlobButton } from '@/components/blob/BlobButton';

/*
 * HomeHero — hero unifié Dark Ocean avec poster statique.
 *
 * Design : Dark Ocean (fond sombre + jaune Blob + blanc cassé).
 * Animations : CSS-only via motion-safe + blob-stagger-N.
 * Poster : /videos/hero-poster.webp (LCP, priority).
 * Vidéo : réintégrée en LOT 5 après optimisation ffmpeg.
 *
 * Note asset : hero-poster.webp = 1.7 MB — à optimiser
 * vers ~200 KB avant mise en production (cible WebP 85%).
 */
export function HomeHero() {
  return (
    <section
      aria-label="Blob — La communauté surf & kite du Médoc Atlantique"
      className="relative rounded-2xl overflow-hidden"
    >
      {/* Poster — LCP element, chargé en priority */}
      <div className="absolute inset-0">
        <Image
          src="/videos/hero-poster.webp"
          alt=""
          fill
          priority
          className="object-cover object-center"
          sizes="(min-width: 1280px) 792px, 100vw"
        />
        {/* Overlay Dark Ocean cinématique */}
        <div
          className="absolute inset-0 bg-gradient-to-b from-blob-black/80 via-blob-black/35 to-blob-black/90"
          aria-hidden
        />
      </div>

      {/* Contenu hero */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center min-h-[560px] sm:min-h-[620px] px-6 py-14 gap-4 sm:gap-5">

        {/* Logo Blob — no animation, rendu immédiat */}
        <Image
          src="/images/home/blob-wordmark.png"
          alt="Blob — Communauté surf & kite du Médoc Atlantique"
          width={1150}
          height={535}
          priority
          className="w-40 sm:w-56 lg:w-64 drop-shadow-[0_2px_20px_rgba(0,0,0,0.7)]"
          sizes="(min-width: 1024px) 256px, (min-width: 640px) 224px, 160px"
        />

        {/* Trait de marque — s'étend comme un coup de pinceau */}
        <div
          className="h-px w-20 rounded-full bg-blob-yellow origin-left motion-safe:animate-blob-separator blob-stagger-1"
          aria-hidden
        />

        {/* H1 — sémantique SEO, entrée progressive */}
        <h1 className="text-white text-xl sm:text-3xl lg:text-4xl font-bold uppercase tracking-[0.08em] text-center drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] max-w-lg motion-safe:animate-blob-reveal blob-stagger-2">
          Trouve ta communauté surf &amp; kite
        </h1>

        {/* Sous-texte */}
        <p className="text-white/80 text-sm sm:text-base max-w-sm sm:max-w-md leading-relaxed motion-safe:animate-blob-reveal blob-stagger-3">
          Riders, pros, débutants ou confirmés : trouve les bonnes personnes pour partager tes sessions.
        </p>

        {/* Pill bêta locale */}
        <span className="inline-flex items-center rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs font-medium tracking-widest uppercase text-white/60 motion-safe:animate-blob-reveal blob-stagger-3">
          Bêta locale · Hourtin · Carcans · Lacanau
        </span>

        {/* CTAs — jaune prioritaire + outline secondaire, côte à côte desktop */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 w-full max-w-xs sm:max-w-none motion-safe:animate-blob-reveal blob-stagger-4">
          <BlobButton asChild variant="primaryYellow" size="lg" className="w-full sm:w-auto">
            <Link href="/register?intent=matching">Je suis rider</Link>
          </BlobButton>
          <BlobButton asChild variant="outlineLight" size="lg" className="w-full sm:w-auto">
            <Link href="/register?intent=pro">Je suis pro</Link>
          </BlobButton>
        </div>

        {/* Mentions discrètes */}
        <p className="text-white/45 text-xs tracking-widest uppercase motion-safe:animate-blob-reveal blob-stagger-5">
          Compte gratuit · Bêta locale ouverte · Sans engagement
        </p>

        <Link
          href="/login"
          className="text-white/55 text-sm transition-colors duration-200 hover:text-white/90 hover:underline motion-safe:animate-blob-reveal blob-stagger-5"
        >
          Déjà membre ? Se connecter
        </Link>
      </div>
    </section>
  );
}
