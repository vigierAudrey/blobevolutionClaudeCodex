import { HomeFeatureCarousel } from '@/components/home/HomeFeatureCarousel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'BlobConnect — Communauté Surf & Kite',
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
      {/* Bandeau vidéo limité à la colonne centrale */}
      <section aria-label="Vidéo d ambiance surf et kite">
        <div className="home-hero-video-wrapper">
          <video
            className="home-hero-video"
            // Utiliser le fragment temporel #t=start,end pour ignorer les quelques premières/dernières secondes
            // Ajuste les valeurs (2,22) si besoin.
            src="/videos/surf-kite-full.webm#t=2,22"
            autoPlay
            loop
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Image
              src="/images/home/Surf&Kite.png"
              alt=""
              width={1113}
              height={399}
              priority
              aria-hidden="true"
              className="w-[80%] max-w-[720px]"
              sizes="(min-width: 768px) 60vw, 90vw"
            />
          </div>
        </div>
      </section>
      {/* HERO condensé */}
      <section className="relative rounded-3xl border bg-gradient-to-br from-sky-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 px-6 py-4 shadow-sm sm:px-10 sm:py-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-sky-100 dark:bg-slate-800/40 blur-2xl md:h-56 md:w-56"
        />
        <div className="relative flex flex-col items-center justify-center gap-4 text-center sm:flex-row sm:text-left">
          <h1 className="font-display text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
            Ta communauté connectée
          </h1>
          <Image
            src="/images/home/geolocSymbol.png"
            alt="Repères géolocalisés"
            width={906}
            height={863}
            className="w-20 sm:w-24 lg:w-28"
            sizes="(min-width: 1024px) 8vw, 20vw"
          />
        </div>
      </section>

      {/* Section découverte avec CTA */}
      <section aria-label="Découvre la plateforme" className="space-y-10 pb-8">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tout ce qu'il te faut</p>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Matching, cours, promos et conseils
          </h2>
        </div>

        {/* CTA centré et visible */}
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
        <div className="space-y-2">
          <h2 id="choose-circuit" className="text-3xl font-semibold tracking-tight text-foreground">
            Choisis ton circuit
          </h2>
          <p className="text-base text-muted-foreground">Tu viens pour rider avec quelqu’un, ou pour trouver un pro ?</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Circuit 1: Ride à deux */}
          <Card className="group h-full overflow-hidden transition hover:-translate-y-0.5 hover:shadow-xl animate-in fade-in-50 duration-500" style={{ animationDelay: '120ms' }}>
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
            <CardHeader className="space-y-3">
              <CardTitle className="flex items-center gap-3 text-2xl">
                <span aria-hidden className="transition group-hover:scale-110">🤝</span> Ride à deux
              </CardTitle>
              <CardDescription>Pas besoin d'un pro ? Trouve ton binôme et organise la session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>1) Choisis sport (kite/surf) et ton niveau</li>
                <li>2) Indique date + zone</li>
                <li>3) Matching des profils compatibles</li>
                <li>4) Ouvre la conversation et cale la session</li>
              </ul>
              <Button asChild size="lg" className="transition hover:-translate-y-0.5">
                <Link href="/register?intent=matching">Commencer le matching</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Circuit 2: Avec un pro */}
          <Card className="group h-full overflow-hidden transition hover:-translate-y-0.5 hover:shadow-xl animate-in fade-in-50 duration-500" style={{ animationDelay: '220ms' }}>
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
            <CardHeader className="space-y-3">
              <CardTitle className="flex items-center gap-3 text-2xl">
                <span aria-hidden className="transition group-hover:scale-110">🎓</span> Avec un pro
              </CardTitle>
              <CardDescription>Signale que tu veux un cours. Les pros proches te contactent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>1) Active « Je cherche un cours »</li>
                <li>2) Choisis sport, niveau, date et zone</li>
                <li>3) Reçois des propositions des pros autour de toi</li>
                <li>4) Réserve ou discute avant de confirmer</li>
              </ul>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg" className="transition hover:-translate-y-0.5">
                  <Link href="/register?intent=lesson-request">Publier ma demande</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="transition hover:-translate-y-0.5">
                  <Link href="/register?intent=offers">Voir les offres autour de moi</Link>
                </Button>
              </div>
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
        <Link
          href="/promos"
          aria-label="Voir les bons plans"
          className="group block rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:bg-accent hover:shadow-lg"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 id="bons-plans" className="text-3xl font-semibold tracking-tight text-foreground">
                Bons plans riders
              </h2>
              <p className="text-base text-muted-foreground">Offres spéciales pour la communauté kite et surf.</p>
            </div>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 group-hover:underline">
              Voir les bons plans <span aria-hidden>→</span>
            </span>
          </div>
          <span className="sr-only">Voir les bons plans</span>
        </Link>
        {/* Grille supprimée pour simplifier la section */}
      </section>

      {/* BLOBO- LIGHT TOUCH */}
      <section aria-labelledby="blobosphere" className="space-y-4">
        <Link
          href="/blobosphere"
          aria-label="Explorer"
          className="group block rounded-2xl border p-5 transition hover:-translate-y-0.5 hover:bg-accent hover:shadow-lg"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 id="blobosphere" className="text-3xl font-semibold tracking-tight text-foreground">
                Blobosphère
              </h2>
              <p className="text-base text-muted-foreground">Conseils équipement, environnement, santé… et bientôt des interviews inspirantes.</p>
            </div>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 group-hover:underline">
              Explorer <span aria-hidden>→</span>
            </span>
          </div>
          <span className="sr-only">Explorer</span>
        </Link>
        {/* Cartes d’aperçu supprimées pour alléger. Un simple CTA suffit. */}
      </section>
      </div>

      {/* Right ad (very large screens only) */}
      <aside aria-label="Publicité latérale" className="sticky top-20 hidden 2xl:block">
        <AdBannerSidebar slot={rightSlot} />
      </aside>
      </div>
  );
}
