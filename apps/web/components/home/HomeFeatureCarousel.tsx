 'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const slides = [
  {
    id: 'matching',
    title: 'Matching entre riders',
    emoji: '🤝',
    description: 'Trouve rapidement un binôme pour ta prochaine session surf ou kite.',
    href: '/register?intent=matching',
    ctaLabel: 'Commencer le matching',
    colorClass:
      'from-orange-200 via-rose-200 to-pink-200 dark:from-orange-500/40 dark:via-rose-500/30 dark:to-pink-500/40',
    shadowClass: 'shadow-orange-200/50 hover:shadow-rose-300/60',
    imageSrc: '/images/home/matching.webp',
    imageAlt: 'Deux riders marchent sur la plage avec leurs planches',
  },
  {
    id: 'lesson',
    title: 'Cours avec un pro',
    emoji: '🎓',
    description: 'Réserve un cours avec un moniteur autour de toi.',
    href: '/register?intent=lesson-request',
    ctaLabel: 'Trouver un cours',
    colorClass:
      'from-purple-200 via-violet-200 to-indigo-200 dark:from-purple-500/40 dark:via-violet-500/30 dark:to-indigo-500/40',
    shadowClass: 'shadow-purple-200/50 hover:shadow-violet-300/60',
    imageSrc: '/images/home/lessons.webp',
    imageAlt: 'Moniteur de kite donnant un cours dans les vagues',
  },
  {
    id: 'promos',
    title: 'Promos & bons plans',
    emoji: '💸',
    description: 'Réductions matos, stages et bons plans réservés à la communauté.',
    href: '/promos',
    ctaLabel: 'Voir les promos',
    colorClass:
      'from-emerald-200 via-teal-200 to-cyan-200 dark:from-emerald-500/40 dark:via-teal-500/30 dark:to-cyan-500/40',
    shadowClass: 'shadow-emerald-200/50 hover:shadow-teal-300/60',
    imageSrc: '/images/home/promos.webp',
    imageAlt: 'Équipement de surf et de kite aligné sur le sable',
  },
  {
    id: 'actus',
    title: 'Conseils & actus',
    emoji: '🌊',
    description: 'Tips sécurité, matos et actus surf & kite pour rester au niveau.',
    href: '/blobosphere',
    ctaLabel: 'Lire les conseils',
    colorClass:
      'from-sky-200 via-blue-200 to-indigo-200 dark:from-sky-500/40 dark:via-blue-500/30 dark:to-indigo-500/40',
    shadowClass: 'shadow-sky-200/50 hover:shadow-blue-300/60',
    imageSrc: '/images/home/actus.webp',
    imageAlt: 'Vague vue du ciel avec un rider en action',
  },
];

export function HomeFeatureCarousel() {
  const [isPaused, setIsPaused] = useState(false);

  // Défilement automatique doux des cartes sur une seule ligne
  useEffect(() => {
    if (typeof window === 'undefined' || isPaused) return;
    const container = document.querySelector<HTMLElement>('#home-feature-carousel');
    if (!container) return;

    let animationFrameId: number;
    let lastTimestamp: number | null = null;
    const speed = 0.06; // pixels par milliseconde ~ lent mais bien visible

    const step = (timestamp: number) => {
      if (lastTimestamp !== null) {
        const delta = timestamp - lastTimestamp;
        container.scrollLeft += delta * speed;

        // Quand on arrive au bout, on revient en douceur au début
        if (container.scrollLeft + container.clientWidth >= container.scrollWidth - 1) {
          container.scrollLeft = 0;
        }
      }
      lastTimestamp = timestamp;
      animationFrameId = window.requestAnimationFrame(step);
    };

    animationFrameId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [isPaused]);

  const scroll = (direction: 'left' | 'right') => {
    if (typeof window === 'undefined') return;
    const container = document.querySelector<HTMLElement>('#home-feature-carousel');
    if (!container) return;
    const card = container.querySelector<HTMLElement>('[data-slide-card]');
    const delta = card ? card.clientWidth + 24 : 280;
    const offset = direction === 'left' ? -delta : delta;
    container.scrollBy({ left: offset, behavior: 'smooth' });
  };

  return (
    <section aria-label="Fonctionnalités de la plateforme">
      <div
        id="home-feature-carousel"
        className="flex gap-6 overflow-x-auto px-4 pb-4 pt-4 lg:grid lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-0"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        {slides.map((slide) => (
          <Card
            key={slide.id}
            data-slide-card
            // Carte adaptative : largeur fixe sur mobile, flex sur desktop
            className={`w-[280px] shrink-0 border-none transition-all duration-300 hover:-translate-y-1 bg-gradient-to-br lg:w-auto ${slide.colorClass} ${slide.shadowClass}`}
          >
            <CardHeader className="flex flex-col items-center space-y-4 pb-4 pt-4">
              {slide.imageSrc && (
                <div className="relative h-[250px] w-[250px] overflow-hidden rounded-2xl shadow-xl lg:h-[200px] lg:w-[200px]">
                  <Image
                    src={slide.imageSrc}
                    alt={slide.imageAlt ?? slide.title}
                    fill
                    className="object-cover transition-transform duration-500 hover:scale-110"
                    sizes="(min-width: 1024px) 200px, 250px"
                    priority={slide.id === 'matching'}
                    quality={90}
                  />
                </div>
              )}
              <CardTitle className="flex items-center gap-2 text-xl text-center">
                <span aria-hidden className="text-2xl">{slide.emoji}</span>
                {slide.title}
              </CardTitle>
              <CardDescription className="text-sm leading-relaxed text-center">{slide.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 pb-4 flex justify-center">
              <Link
                href={slide.href}
                className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline transition-colors"
              >
                {slide.ctaLabel}
                <span aria-hidden className="ml-1">
                  →
                </span>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
