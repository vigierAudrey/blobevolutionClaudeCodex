import Image from 'next/image';
import Link from 'next/link';
import { BlobButton } from '@/components/blob/BlobButton';
import { HomeEditorialCards } from '@/components/home/HomeEditorialCards';

/*
 * HomeHeroSplit — hero splitté 2 colonnes, Server Component.
 *
 * Mobile / tablet : hero pleine largeur, cartes empilées en dessous.
 * lg (1024px+) : [hero flex-1] + [cartes lg:w-[380px]].
 *
 * Hero gauche :
 *   - fond : /videos/hero-poster.webp (LCP, priority)
 *   - overlay dégradé sombre cinématique
 *   - titre uppercase fort + sous-titre Adlery Pro jaune + CTA
 *
 * Cartes droite : HomeEditorialCards (4 cartes éditoriales, dark)
 *
 * Brise out du container via -mx pour couvrir toute la largeur viewport.
 */
export function HomeHeroSplit() {
  return (
    <section
      aria-label="Blob — La communauté surf & kite du Médoc Atlantique"
      className="-mx-4 sm:-mx-6 lg:-mx-8"
    >
      <div className="flex flex-col lg:flex-row">

        {/* ============================================================
            GAUCHE — Hero immersif
        ============================================================ */}
        <div className="relative flex-1 min-h-[520px] lg:min-h-[640px] overflow-hidden">

          {/* Poster — LCP */}
          <Image
            src="/videos/hero-poster.webp"
            alt=""
            fill
            priority
            className="object-cover object-center"
            sizes="(min-width: 1024px) 65vw, 100vw"
          />

          {/* Overlay Dark Ocean */}
          <div
            className="absolute inset-0 bg-gradient-to-b from-blob-black/80 via-blob-black/30 to-blob-black/90"
            aria-hidden
          />

          {/* Contenu hero */}
          <div className="relative z-10 flex flex-col justify-end h-full px-6 sm:px-10 lg:px-12 xl:px-16 pb-12 pt-20 gap-4 sm:gap-5">

            {/* H1 — sémantique SEO, uppercase fort */}
            <h1 className="text-white font-black uppercase leading-[0.95] tracking-tight text-4xl sm:text-5xl lg:text-5xl xl:text-6xl drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)] max-w-xl">
              La communauté
              <br />
              Surf &amp; Kite
            </h1>

            {/* Sous-titre — Adlery Pro script, jaune Blob */}
            <p
              className="font-display text-blob-yellow italic text-2xl sm:text-3xl lg:text-3xl xl:text-4xl leading-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] max-w-xl"
              aria-hidden={false}
            >
              du Médoc Atlantique
            </p>

            {/* Description */}
            <p className="text-white/75 text-sm sm:text-base max-w-sm sm:max-w-md leading-relaxed">
              Trouve ton binôme, réserve avec un pro, découvre les bons plans et progresse avec des conseils utiles.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mt-1 sm:mt-2">
              <BlobButton asChild variant="primaryYellow" size="lg">
                <Link href="/register?intent=matching">Je suis rider</Link>
              </BlobButton>
              <BlobButton asChild variant="outlineLight" size="lg">
                <Link href="/register?intent=pro">Je suis pro</Link>
              </BlobButton>
            </div>

          </div>
        </div>

        {/* ============================================================
            DROITE — 4 cartes éditoriales
        ============================================================ */}
        <div className="lg:w-[360px] xl:w-[400px] shrink-0 bg-blob-black border-t border-white/[0.07] lg:border-t-0 lg:border-l lg:border-white/[0.07]">
          <HomeEditorialCards />
        </div>

      </div>
    </section>
  );
}
