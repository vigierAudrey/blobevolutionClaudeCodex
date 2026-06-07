import Image from 'next/image';
import Link from 'next/link';
import { GraduationCap, Tag, BookOpen, ArrowRight, type LucideIcon } from 'lucide-react';

type EditorialCard = {
  n: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  imageSrc: string;
  imageAlt: string;
  /* Carte 01 : affiche le "B" Blob (Adlery Pro) au lieu d'une icône */
  blobLogo?: true;
  Icon?: LucideIcon;
};

const cards: EditorialCard[] = [
  {
    n: '01',
    title: 'Trouve ton binôme',
    description: 'Matching rapide entre riders selon ton niveau et tes envies.',
    cta: 'Lancer le matching',
    href: '/register?intent=matching',
    imageSrc: '/images/home/matching-square.webp',
    imageAlt: "Deux riders face à l'océan au coucher de soleil",
    blobLogo: true,
  },
  {
    n: '02',
    title: 'Réserve avec des pros locaux',
    description: 'Cours particuliers ou collectifs, choisis ton spot et ton pro.',
    cta: 'Voir les pros',
    href: '/register?intent=lesson-request',
    imageSrc: '/images/home/lessons-square.webp',
    imageAlt: 'Groupe de riders avec un moniteur de kite sur la plage du Médoc',
    Icon: GraduationCap,
  },
  {
    n: '03',
    title: 'Bons plans exclusifs',
    description: 'Promos, matos, stages, événements réservés à la communauté.',
    cta: 'Voir les offres',
    href: '/promos',
    imageSrc: '/images/home/bons-plans-riders-square-700.webp',
    imageAlt: 'Planches de surf et matériel kite dans un shop local du Médoc',
    Icon: Tag,
  },
  {
    n: '04',
    title: 'Conseils & guides',
    description: 'Sécurité, météo, matos, spots — tous nos conseils pour progresser.',
    cta: 'Lire les guides',
    href: '/blobosphere',
    imageSrc: '/images/home/actus-medoc-local-square-700.webp',
    imageAlt: 'Kitesurf en action dans le Médoc Atlantique',
    Icon: BookOpen,
  },
];

/*
 * HomeEditorialCards — 4 cartes éditoriales verticales.
 *
 * Mobile : empilement pleine largeur.
 * sm (640px+) : grille 2×2.
 * lg (1024px+) : colonne unique dans le panneau droit du hero split,
 *   chaque carte prend la place disponible (flex-1).
 *
 * Carte 01 : B marque transparent, sans fond jaune embarqué.
 * Assets images : tous vérifiés sur disque.
 */
export function HomeEditorialCards() {
  return (
    <div className="flex flex-col sm:grid sm:grid-cols-2 lg:flex lg:flex-col lg:h-full gap-3">
      {cards.map((card) => {
        const Icon = card.Icon;
        return (
          <Link
            key={card.n}
            href={card.href}
            className="group relative flex-1 grid overflow-hidden bg-blob-sand dark:bg-[hsl(220_14%_14%)] text-blob-black dark:text-white shadow-[0_1px_0_rgba(0,0,0,0.08)] dark:shadow-none ring-1 ring-blob-black/10 dark:ring-white/8 transition-colors duration-300 hover:bg-white dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blob-yellow lg:grid-cols-[1fr_42%]"
            aria-label={`${card.title} — ${card.cta}`}
          >
            {/* Image */}
            <div className="relative h-40 w-full overflow-hidden lg:order-2 lg:h-full">
              <Image
                src={card.imageSrc}
                alt={card.imageAlt}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                sizes="(min-width: 1024px) 180px, (min-width: 640px) 50vw, 100vw"
              />
              <div
                className="absolute inset-y-0 left-0 hidden w-12 bg-gradient-to-r from-blob-sand dark:from-[hsl(220_14%_14%)] to-transparent lg:block"
                aria-hidden
              />
            </div>

            {/* Contenu */}
            <div className="flex min-h-[150px] flex-col gap-2 px-4 py-4 lg:min-h-0 xl:px-5 xl:py-5">

              {/* Numéro + icône/logo */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-blob-yellow font-black text-[26px] leading-none"
                  aria-hidden
                >
                  {card.n}
                </span>

                {/* Carte 01 : B Blob transparent sur jaune du design system. */}
                {card.blobLogo && (
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blob-yellow"
                    aria-hidden
                  >
                    <Image
                      src="/images/brand/blob-b-mark-transparent.png"
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 object-contain"
                    />
                  </span>
                )}

                {/* Autres cartes : icône Lucide */}
                {Icon && !card.blobLogo && (
                  <Icon
                    size={18}
                    className="text-blob-black/70 dark:text-white/55 shrink-0"
                    aria-hidden
                  />
                )}
              </div>

              {/* Titre */}
              <p className="text-blob-black dark:text-white font-black uppercase tracking-wide text-sm sm:text-base lg:text-[15px] xl:text-base leading-tight">
                {card.title}
              </p>

              {/* Description */}
              <p className="text-blob-black/70 dark:text-white/65 text-[11px] leading-relaxed">
                {card.description}
              </p>

              {/* CTA textuel */}
              <span className="mt-auto inline-flex w-fit items-center gap-2 bg-blob-black px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition-colors duration-200 group-hover:text-blob-yellow">
                {card.cta}
                <ArrowRight
                  size={11}
                  className="group-hover:translate-x-0.5 transition-transform duration-200"
                  aria-hidden
                />
              </span>

            </div>
          </Link>
        );
      })}
    </div>
  );
}
