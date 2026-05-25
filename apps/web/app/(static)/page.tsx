import { HomeFeatureCarousel } from '@/components/home/HomeFeatureCarousel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { Users, GraduationCap, Tag, BookOpen, ArrowRight } from 'lucide-react';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Blob — Communauté Surf & Kite',
  description:
    'Rejoins la communauté surf & kite : trouve des partenaires, réserve un cours et organise tes sessions facilement.',
};

// Retiré: ancien bloc "Comment ça marche" (3 étapes)

export default function Home() {
  const AdBannerSidebar = dynamic(
    () => import('@/components/ads/AdBanner').then((m) => m.AdBannerSidebar),
    { ssr: false },
  );
  const AdBannerFeed = dynamic(
    () => import('@/components/ads/AdBanner').then((m) => m.AdBannerFeed),
    { ssr: false },
  );
  const leftSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME_LEFT || 'home-left';
  const rightSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME_RIGHT || 'home-right';
  const mobileFeedSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME_MOBILE || 'home-mobile';
  return (
    <div className="xl:grid xl:grid-cols-[220px,1fr,220px] xl:gap-6">
      {/* Left ad (desktop only) */}
      <aside aria-label="Publicité latérale" className="sticky top-20 hidden xl:block">
        <AdBannerSidebar slot={leftSlot} />
      </aside>

      {/* Main column */}
      <div className="space-y-8">
      {/* Hero : vidéo océan + wordmark Blob */}
      <section aria-label="Blob — Ta communauté Surf et Kite" className="space-y-4">
        <div className="home-hero-video-wrapper">
          <video
            className="home-hero-video"
            src="/videos/surf-kite-full.webm#t=2,22"
            autoPlay
            loop
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-0 bg-black/30" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-4">
            <Image
              src="/images/home/blob-wordmark.png"
              alt="Blob"
              width={1150}
              height={535}
              priority
              className="mx-auto w-72 sm:w-96 lg:w-[480px] drop-shadow-[0_2px_24px_rgba(0,0,0,0.5)]"
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 40vw, 60vw"
            />
            <div className="h-px w-20 rounded-full bg-[#C8A96E]" aria-hidden="true" />
            <p className="text-white/90 text-base sm:text-lg lg:text-xl font-medium tracking-[0.2em] uppercase text-center drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
              Ta communauté Surf &amp; Kite connectée
            </p>
          </div>
        </div>
      </section>
      {/* Section CTA */}
      <section aria-label="Découvre la plateforme" className="space-y-6 pb-8">
        <h2 className="text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Matching, cours, promos et conseils
        </h2>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button asChild size="lg" className="w-full sm:w-auto text-base px-8 py-6 shadow-lg hover:shadow-xl transition-all">
            <Link href="/register">Créer un compte</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto text-base px-8 py-6 hover:bg-accent transition-all">
            <Link href="/login">Se connecter</Link>
          </Button>
        </div>
      </section>

      {/* Modules principaux */}
      <HomeFeatureCarousel />

      {/* CIRCUITS PRINCIPAUX */}
      <section aria-labelledby="choose-circuit" className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-blue-500" />
            <h2 id="choose-circuit" className="text-3xl font-semibold tracking-tight text-foreground">
              Choisis ton circuit
            </h2>
          </div>
          <p className="text-base text-muted-foreground">Tu viens pour rider avec quelqu&apos;un, ou pour trouver un pro ?</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Circuit 1: Ride à deux */}
          <Card className="group h-full overflow-hidden border-2 border-transparent hover:border-blue-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl animate-in fade-in-50" style={{ animationDelay: '120ms' }}>
            <div className="relative h-64 w-full overflow-hidden">
              <Image
                src="/images/home/RideaDeux.png"
                alt="Riders organisant une session à deux"
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(min-width: 768px) 50vw, 100vw"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </div>
            <CardHeader className="space-y-3 bg-gradient-to-br from-blue-50/80 to-transparent dark:from-blue-950/30 dark:to-transparent">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                    <Users size={24} />
                  </div>
                  <CardTitle className="text-2xl">Ride à deux</CardTitle>
                </div>
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-100">
                  Matching
                </Badge>
              </div>
              <CardDescription>Pas besoin d&apos;un pro ? Trouve ton binôme et organise la session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-semibold">1.</span>
                  <span>Choisis sport (kite/surf) et ton niveau</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-semibold">2.</span>
                  <span>Indique date + zone</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-semibold">3.</span>
                  <span>Matching des profils compatibles</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-semibold">4.</span>
                  <span>Ouvre la conversation et cale la session</span>
                </li>
              </ul>
              <Button asChild size="lg" className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-lg hover:shadow-xl transition-all group-hover:scale-105">
                <Link href="/register?intent=matching" className="inline-flex items-center justify-center gap-2">
                  Commencer le matching
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Circuit 2: Avec un pro */}
          <Card className="group h-full overflow-hidden border-2 border-transparent hover:border-emerald-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl animate-in fade-in-50" style={{ animationDelay: '220ms' }}>
            <div className="relative h-64 w-full overflow-hidden">
              <Image
                src="/images/home/CoursAvecPro.png"
                alt="Cours de kite avec un professionnel"
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(min-width: 768px) 50vw, 100vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            </div>
            <CardHeader className="space-y-3 bg-gradient-to-br from-emerald-50/80 to-transparent dark:from-emerald-950/30 dark:to-transparent">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                    <GraduationCap size={24} />
                  </div>
                  <CardTitle className="text-2xl">Avec un pro</CardTitle>
                </div>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100">
                  Cours
                </Badge>
              </div>
              <CardDescription>Signale que tu veux un cours. Les pros proches te contactent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-semibold">1.</span>
                  <span>Active « Je cherche un cours »</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-semibold">2.</span>
                  <span>Choisis sport, niveau, date et zone</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-semibold">3.</span>
                  <span>Reçois des propositions des pros autour de toi</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-semibold">4.</span>
                  <span>Réserve ou discute avant de confirmer</span>
                </li>
              </ul>
              <Button asChild size="lg" className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg hover:shadow-xl transition-all group-hover:scale-105">
                <Link href="/register?intent=lesson-request" className="inline-flex items-center justify-center gap-2">
                  Publier ma demande
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Mobile in-content ad (hidden on large screens) */}
      <div className="lg:hidden">
        <AdBannerFeed slot={mobileFeedSlot} className="my-4" />
      </div>

      {/* STEPS supprimé pour alléger la page */}

      {/* BONS PLANS */}
      <section aria-labelledby="bons-plans" className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-amber-500" />
          <h2 id="bons-plans" className="text-2xl font-semibold tracking-tight text-foreground">
            Bons plans riders
          </h2>
        </div>
        <Link href="/promos" aria-label="Voir les bons plans" className="group block">
          <Card className="overflow-hidden border-2 border-transparent hover:border-amber-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
            <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                    <Tag size={24} />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">Bons plans riders</CardTitle>
                    <CardDescription className="mt-1">Offres spéciales pour la communauté kite et surf</CardDescription>
                  </div>
                </div>
                <Badge className="bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                  Promos
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-4">
                Profite d&apos;offres exclusives : matériel, spots, hébergements et services pour riders à prix réduits.
              </p>
              <Button size="lg" className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 shadow-lg hover:shadow-xl transition-all group-hover:scale-105">
                <span className="inline-flex items-center gap-2">
                  Voir les bons plans
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>
            </CardContent>
          </Card>
        </Link>
      </section>

      {/* BLOBOSPHÈRE */}
      <section aria-labelledby="blobosphere" className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-indigo-500" />
          <h2 id="blobosphere" className="text-2xl font-semibold tracking-tight text-foreground">
            Blobosphère
          </h2>
        </div>
        <Link href="/blobosphere" aria-label="Explorer la Blobosphère" className="group block">
          <Card className="overflow-hidden border-2 border-transparent hover:border-indigo-300 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
            <CardHeader className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg group-hover:scale-110 transition-transform">
                    <BookOpen size={24} />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">Blobosphère</CardTitle>
                    <CardDescription className="mt-1">Guides & conseils riders</CardDescription>
                  </div>
                </div>
                <Badge className="bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">
                  Guides
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-4">
                Équipement, environnement, santé : tout pour rider en conscience. Découvre nos articles et interviews inspirantes.
              </p>
              <Button size="lg" className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 shadow-lg hover:shadow-xl transition-all group-hover:scale-105">
                <span className="inline-flex items-center gap-2">
                  Explorer la Blobosphère
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </Button>
            </CardContent>
          </Card>
        </Link>
      </section>
      </div>

      {/* Right ad (very large screens only) */}
      <aside aria-label="Publicité latérale" className="sticky top-20 hidden 2xl:block">
        <AdBannerSidebar slot={rightSlot} />
      </aside>
      </div>
  );
}
