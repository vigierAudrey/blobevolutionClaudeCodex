import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { HomeEditorialCards } from '@/components/home/HomeEditorialCards';
import { HomeYellowBar } from '@/components/home/HomeYellowBar';
import { HeroAnimated } from '@/components/home/HeroAnimated';

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
 * Cartes droite : HomeEditorialCards (4 cartes éditoriales, fond papier)
 *
 * Brise out du container via -mx pour couvrir toute la largeur viewport.
 */
export function HomeHeroSplit() {
  const t = useTranslations('home.hero');

  return (
    <section
      aria-label={t('ariaSection')}
      className="-mx-4 bg-blob-sand dark:bg-blob-black sm:-mx-6 lg:-mx-8"
    >
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]">

        {/* ============================================================
            GAUCHE — Hero immersif
        ============================================================ */}
        <div className="relative order-1 min-h-[520px] overflow-hidden lg:col-start-1 lg:row-start-1 lg:min-h-[740px]">

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

          {/* Contenu hero — client boundary isolé pour les animations */}
          <div className="relative z-10 flex flex-col justify-start h-full px-7 sm:px-12 lg:pl-16 lg:pr-12 xl:pl-20 xl:pr-16 pt-28 sm:pt-32 lg:pt-34 xl:pt-36 pb-12">
            <HeroAnimated />
          </div>
        </div>

        {/* ============================================================
            DROITE — 4 cartes éditoriales
        ============================================================ */}
        <div className="order-2 shrink-0 bg-blob-sand dark:bg-[hsl(220_14%_12%)] px-3 pb-3 pt-3 sm:px-4 sm:pb-4 sm:pt-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:px-3 lg:pb-3 lg:pt-[96px] xl:px-4 xl:pb-4 xl:pt-[100px] border-t border-blob-black/10 dark:border-white/10 lg:border-t-0 lg:border-l lg:border-white/70 dark:lg:border-white/15">
          <HomeEditorialCards />
        </div>

        <div className="order-3 lg:col-start-1 lg:row-start-2">
          <HomeYellowBar />
        </div>

      </div>
    </section>
  );
}
