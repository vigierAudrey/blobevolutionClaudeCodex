 'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Users, GraduationCap, Tag, BookOpen, ArrowRight } from 'lucide-react';

const slides = [
  {
    id: 'matching',
    title: 'Matching entre riders',
    icon: Users,
    badge: 'Matching',
    badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-100',
    description: 'Trouve rapidement un binôme pour ta prochaine session surf ou kite.',
    href: '/register?intent=matching',
    ctaLabel: 'Commencer le matching',
    colorClass:
      'from-blue-100 via-cyan-100 to-blue-50 dark:from-blue-500/30 dark:via-cyan-500/20 dark:to-blue-500/30',
    iconGradient: 'from-blue-500 to-cyan-500',
    buttonGradient: 'from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700',
    borderColor: 'hover:border-blue-300',
    shadowClass: 'hover:shadow-blue-200/60',
    imageSrc: '/images/home/matching.webp',
    imageAlt: 'Deux riders marchent sur la plage avec leurs planches',
  },
  {
    id: 'lesson',
    title: 'Cours avec un pro',
    icon: GraduationCap,
    badge: 'Cours',
    badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100',
    description: 'Réserve un cours avec un moniteur autour de toi.',
    href: '/register?intent=lesson-request',
    ctaLabel: 'Trouver un cours',
    colorClass:
      'from-emerald-100 via-teal-100 to-emerald-50 dark:from-emerald-500/30 dark:via-teal-500/20 dark:to-emerald-500/30',
    iconGradient: 'from-emerald-500 to-teal-500',
    buttonGradient: 'from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700',
    borderColor: 'hover:border-emerald-300',
    shadowClass: 'hover:shadow-emerald-200/60',
    imageSrc: '/images/home/lessons.webp',
    imageAlt: 'Moniteur de kite donnant un cours dans les vagues',
  },
  {
    id: 'promos',
    title: 'Promos & bons plans',
    icon: Tag,
    badge: 'Promos',
    badgeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100',
    description: 'Réductions matos, stages et bons plans réservés à la communauté.',
    href: '/promos',
    ctaLabel: 'Voir les promos',
    colorClass:
      'from-amber-100 via-orange-100 to-amber-50 dark:from-amber-500/30 dark:via-orange-500/20 dark:to-amber-500/30',
    iconGradient: 'from-amber-500 to-orange-500',
    buttonGradient: 'from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700',
    borderColor: 'hover:border-amber-300',
    shadowClass: 'hover:shadow-amber-200/60',
    imageSrc: '/images/home/promos.webp',
    imageAlt: 'Équipement de surf et de kite aligné sur le sable',
  },
  {
    id: 'actus',
    title: 'Conseils & actus',
    icon: BookOpen,
    badge: 'Guides',
    badgeColor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-100',
    description: 'Tips sécurité, matos et actus surf & kite pour rester au niveau.',
    href: '/blobosphere',
    ctaLabel: 'Lire les conseils',
    colorClass:
      'from-indigo-100 via-blue-100 to-indigo-50 dark:from-indigo-500/30 dark:via-blue-500/20 dark:to-indigo-500/30',
    iconGradient: 'from-indigo-600 to-blue-600',
    buttonGradient: 'from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700',
    borderColor: 'hover:border-indigo-300',
    shadowClass: 'hover:shadow-indigo-200/60',
    imageSrc: '/images/home/actus.webp',
    imageAlt: 'Vague vue du ciel avec un rider en action',
  },
];

export function HomeFeatureCarousel() {
  const [isPaused, setIsPaused] = useState(false);

  // Pas d'auto-scroll, juste du swipe manuel
  useEffect(() => {
    // Auto-scroll désactivé pour une meilleure UX
    return () => {};
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
        className="flex gap-6 overflow-x-auto px-4 pb-4 pt-4 lg:grid lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-0 scrollbar-hide"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        {slides.map((slide) => {
          const IconComponent = slide.icon;
          return (
            <Card
              key={slide.id}
              data-slide-card
              className={`group w-[280px] h-[560px] shrink-0 border-2 border-transparent ${slide.borderColor} transition-all duration-300 hover:-translate-y-1 hover:shadow-xl bg-gradient-to-br lg:w-auto lg:h-[540px] flex flex-col ${slide.colorClass} ${slide.shadowClass}`}
            >
              <CardHeader className="flex flex-col items-center space-y-4 pb-4 pt-6 flex-1">
                <div className="flex items-center justify-between w-full px-2">
                  <div className={`p-2 rounded-lg bg-gradient-to-br ${slide.iconGradient} text-white shadow-lg group-hover:scale-110 transition-transform`}>
                    <IconComponent size={20} />
                  </div>
                  <Badge className={slide.badgeColor}>
                    {slide.badge}
                  </Badge>
                </div>
                {slide.imageSrc && (
                  <div className="relative h-[200px] w-[200px] overflow-hidden rounded-2xl shadow-xl lg:h-[180px] lg:w-[180px]">
                    <Image
                      src={slide.imageSrc}
                      alt={slide.imageAlt ?? slide.title}
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-110"
                      sizes="(min-width: 1024px) 180px, 200px"
                      priority={slide.id === 'matching'}
                      quality={90}
                    />
                  </div>
                )}
                <CardTitle className="text-xl text-center font-semibold">
                  {slide.title}
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed text-center px-2">
                  {slide.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 pb-4 px-4">
                <Button asChild size="lg" className={`w-full bg-gradient-to-r ${slide.buttonGradient} shadow-lg transition-all group-hover:scale-105`}>
                  <Link href={slide.href} className="inline-flex items-center justify-center gap-2">
                    {slide.ctaLabel}
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
