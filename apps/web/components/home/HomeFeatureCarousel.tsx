import Image from 'next/image';
import Link from 'next/link';
import { Users, GraduationCap, BookOpen, ArrowRight } from 'lucide-react';
import { BlobButton } from '@/components/blob/BlobButton';
import { BlobCard } from '@/components/blob/BlobCard';
import { BlobMediaFrame } from '@/components/blob/BlobMediaFrame';

/*
 * HomeFeatureCarousel — 4 cards Dark Ocean, composant serveur (LOT 3).
 * Suppression : gradients SaaS bleu/vert/violet, useState, 'use client'.
 * Chaque card : BlobCard dark + BlobMediaFrame + BlobButton outlineLight.
 * Mobile : scroll horizontal. Desktop : 4 colonnes.
 */

const slides = [
  {
    id: 'matching',
    title: 'Matching entre riders',
    icon: Users,
    badge: 'Matching',
    description: 'Trouve rapidement un binôme pour ta prochaine session surf ou kite.',
    href: '/register?intent=matching',
    ctaLabel: 'Commencer le matching',
    imageSrc: '/images/home/matching-square.webp',
    imageAlt: 'Deux riders marchent sur la plage avec leurs planches',
    priority: true,
  },
  {
    id: 'lesson',
    title: 'Cours avec un pro',
    icon: GraduationCap,
    badge: 'Cours',
    description: 'Demande un cours à un moniteur local sur le Médoc Atlantique.',
    href: '/register?intent=lesson-request',
    ctaLabel: 'Trouver un cours',
    imageSrc: '/images/home/lessons-square.webp',
    imageAlt: 'Moniteur de kite donnant un cours dans les vagues',
    priority: false,
  },
  {
    id: 'actus',
    title: 'Conseils & actus',
    icon: BookOpen,
    badge: 'Guides',
    description: 'Tips sécurité, matos et actus surf & kite pour rester au niveau.',
    href: '/blobosphere',
    ctaLabel: 'Lire les conseils',
    imageSrc: '/images/home/actus-medoc-local-square-700.webp',
    imageAlt: 'Illustration éditoriale du Médoc Atlantique pour les conseils et actus Blob',
    priority: false,
  },
] as const;

export function HomeFeatureCarousel() {
  return (
    <section aria-label="Fonctionnalités de la plateforme">
      <div
        id="home-feature-carousel"
        className="flex gap-4 overflow-x-auto pb-4 pt-1 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:pb-0 scrollbar-hide"
      >
        {slides.map((slide, index) => {
          const Icon = slide.icon;
          return (
            <BlobCard
              key={slide.id}
              mode="dark"
              className="w-[260px] shrink-0 lg:w-auto motion-safe:animate-blob-reveal"
              style={{ animationDelay: `${index * 130}ms` }}
              media={
                <BlobMediaFrame className="relative h-44 w-full" overlayDirection="bottom">
                  <Image
                    src={slide.imageSrc}
                    alt={slide.imageAlt}
                    fill
                    className="object-cover"
                    sizes="(min-width: 1024px) 25vw, 280px"
                    priority={slide.priority}
                  />
                </BlobMediaFrame>
              }
            >
              {/* Icône + badge */}
              <div className="flex items-center justify-between mb-2">
                <Icon size={20} className="text-blob-yellow" aria-hidden />
                <span className="border border-blob-yellow/40 text-blob-yellow text-xs px-2 py-0.5 rounded-sm uppercase tracking-wider font-bold">
                  {slide.badge}
                </span>
              </div>

              {/* Titre */}
              <p className="font-bold uppercase tracking-wide text-white text-sm mb-1">
                {slide.title}
              </p>

              {/* Description */}
              <p className="text-white/60 text-xs leading-relaxed flex-1 mb-4">
                {slide.description}
              </p>

              {/* CTA */}
              <BlobButton asChild variant="outlineLight" size="sm" className="w-full mt-auto">
                <Link href={slide.href} className="inline-flex items-center justify-center gap-2">
                  {slide.ctaLabel}
                  <ArrowRight
                    size={14}
                    className="motion-safe:group-hover:translate-x-1 motion-safe:transition-transform"
                    aria-hidden
                  />
                </Link>
              </BlobButton>
            </BlobCard>
          );
        })}
      </div>
    </section>
  );
}
