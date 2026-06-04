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
 * Carte 01 : logo "B" en Adlery Pro (font-display) — zéro asset additionnel.
 * Assets images : tous vérifiés sur disque.
 */
export function HomeEditorialCards() {
  return (
    <div className="flex flex-col sm:grid sm:grid-cols-2 lg:flex lg:flex-col lg:h-full divide-y divide-white/[0.07] sm:divide-y-0 lg:divide-y">
      {cards.map((card) => {
        const Icon = card.Icon;
        return (
          <Link
            key={card.n}
            href={card.href}
            className="group relative flex-1 flex flex-col overflow-hidden bg-blob-black hover:bg-[hsl(220_14%_12%)] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blob-yellow"
            aria-label={`${card.title} — ${card.cta}`}
          >
            {/* Image */}
            <div className="relative w-full h-36 lg:h-32 xl:h-36 shrink-0 overflow-hidden">
              <Image
                src={card.imageSrc}
                alt={card.imageAlt}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
              />
              {/* Overlay bas → fondu vers le fond de la carte */}
              <div
                className="absolute inset-0 bg-gradient-to-t from-blob-black/70 via-blob-black/10 to-transparent"
                aria-hidden
              />
            </div>

            {/* Contenu */}
            <div className="flex flex-col flex-1 px-4 py-3 gap-1.5 min-h-[80px]">

              {/* Numéro + icône/logo */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-blob-yellow font-black text-[26px] leading-none"
                  aria-hidden
                >
                  {card.n}
                </span>

                {/* Carte 01 : "B" Adlery Pro — logo de marque Blob */}
                {card.blobLogo && (
                  <span
                    className="font-display text-blob-yellow text-[28px] leading-none select-none"
                    aria-hidden
                  >
                    B
                  </span>
                )}

                {/* Autres cartes : icône Lucide */}
                {Icon && !card.blobLogo && (
                  <Icon
                    size={18}
                    className="text-blob-yellow/70 shrink-0"
                    aria-hidden
                  />
                )}
              </div>

              {/* Titre */}
              <p className="text-white font-bold uppercase tracking-wide text-[11px] sm:text-xs leading-tight">
                {card.title}
              </p>

              {/* Description — masquée sur lg compact, visible sur xl et mobile/tablet */}
              <p className="text-white/50 text-[11px] leading-relaxed lg:hidden xl:block">
                {card.description}
              </p>

              {/* CTA textuel */}
              <span className="inline-flex items-center gap-1 text-white/60 text-[11px] font-bold uppercase tracking-widest mt-auto pt-1 group-hover:text-blob-yellow transition-colors duration-200">
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
