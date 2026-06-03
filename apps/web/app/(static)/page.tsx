import { HomeFeatureCarousel } from '@/components/home/HomeFeatureCarousel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Metadata } from 'next';
import { CommunitySpotlight } from '@/components/community/CommunitySpotlight';
import { CommunityHighlight } from '@/components/community/CommunityHighlight';
import Image from 'next/image';
import Link from 'next/link';
import { Users, GraduationCap, Tag, BookOpen, ArrowRight } from 'lucide-react';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Blob · Communauté Surf & Kite du Médoc Atlantique',
  description:
    'Trouve un partenaire de session, réserve un cours et découvre les bons plans surf et kite sur Hourtin, Carcans et Lacanau.',
};

export default function Home() {
  return (
    <div className="xl:grid xl:grid-cols-[220px,1fr,220px] xl:gap-6">
      {/* Left community spotlight (desktop only) */}
      <aside aria-label="Contenu communautaire" className="sticky top-20 hidden xl:block">
        <CommunitySpotlight variant="partners" />
      </aside>

      {/* Main column */}
      <div className="space-y-8">

        {/* Hero : vidéo océan + wordmark Blob + H1 sémantique */}
        <section aria-label="Blob — La communauté surf & kite du Médoc Atlantique" className="space-y-4">
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
                alt="Blob — Communauté surf & kite du Médoc Atlantique"
                width={1150}
                height={535}
                priority
                className="mx-auto w-72 sm:w-96 lg:w-[480px] drop-shadow-[0_2px_24px_rgba(0,0,0,0.5)]"
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 40vw, 60vw"
              />
              {/* Séparateur amber-400 : signature visuelle de marque Blob */}
              <div className="h-px w-24 rounded-full bg-amber-400" aria-hidden="true" />
              <h1 className="text-white text-lg sm:text-xl lg:text-2xl font-bold tracking-[0.12em] uppercase text-center drop-shadow-[0_1px_10px_rgba(0,0,0,0.8)]">
                Trouve ta communauté surf &amp; kite
              </h1>
              {/* Glass pill : accent de marque léger, sans JS */}
              <span className="inline-flex items-center rounded-full border border-white/20 bg-black/25 px-3 py-1 text-xs font-medium tracking-widest uppercase text-white/65 drop-shadow-[0_1px_4px_rgba(0,0,0,0.4)]">
                Bêta locale · Hourtin · Carcans · Lacanau
              </span>
            </div>
          </div>
        </section>

        {/* Section CTA */}
        <section aria-label="Rejoindre la communauté" className="space-y-6 pb-4">
          <div className="space-y-2 text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Prêt à rider ?
            </h2>
            <p className="text-sm text-muted-foreground tracking-widest uppercase">
              Compte gratuit · Bêta locale ouverte · Sans engagement
            </p>
          </div>

          <p className="text-sm text-center text-muted-foreground max-w-xl mx-auto">
            Riders, pros, débutants ou confirmés : Blob t&apos;aide à trouver les bonnes personnes pour partager tes sessions surf &amp; kite dans le Médoc Atlantique.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="lg" className="w-full sm:w-auto text-base px-8 py-6 shadow-lg hover:shadow-xl transition-all">
              <Link href="/register?intent=matching">Je suis rider</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto text-base px-8 py-6 hover:bg-accent transition-all">
              <Link href="/register?intent=pro">Je suis pro</Link>
            </Button>
          </div>
          <div className="text-center">
            <Link href="/login" className="text-sm text-muted-foreground hover:underline">
              Déjà membre ? Se connecter
            </Link>
          </div>
          <p className="text-xs text-center text-muted-foreground/60">
            Blob se construit avec les premiers riders et pros du Médoc Atlantique.
          </p>
          <p className="text-xs text-center text-muted-foreground/50 max-w-lg mx-auto leading-relaxed">
            Plus la communauté Blob grandit, plus elle devient utile : trouver les bonnes personnes, partager les bons conseils et créer demain des bons plans vraiment pensés pour les riders.
          </p>
        </section>

        {/* Blob te connecte — 3 cartes, scroll-snap mobile, hover CSS, 0 JS client */}
        <section aria-labelledby="blob-connects" className="space-y-6">
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-amber-400" aria-hidden="true" />
            <h2 id="blob-connects" className="text-2xl font-semibold tracking-tight text-foreground">
              Blob te connecte
            </h2>
          </div>
          <ol
            className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0"
            aria-label="Comment Blob te connecte"
          >
            <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 snap-start flex-shrink-0 w-[82vw] sm:w-auto hover:shadow-lg hover:border-amber-400/40 motion-safe:transition-all motion-safe:duration-300 motion-safe:hover:-translate-y-1">
              <span className="text-3xl font-bold text-amber-400" aria-hidden="true">1</span>
              <p className="font-semibold text-foreground">Exprime ton envie</p>
              <p className="text-sm text-muted-foreground">
                Niveau, dispo, ambiance, besoin d&apos;un pro ou d&apos;un rider : tu poses ton intention.
              </p>
            </li>
            <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 snap-start flex-shrink-0 w-[82vw] sm:w-auto hover:shadow-lg hover:border-amber-400/40 motion-safe:transition-all motion-safe:duration-300 motion-safe:hover:-translate-y-1">
              <span className="text-3xl font-bold text-amber-400" aria-hidden="true">2</span>
              <p className="font-semibold text-foreground">Rencontre les bons profils</p>
              <p className="text-sm text-muted-foreground">
                Blob rapproche riders, pros, débutants et confirmés selon ce qu&apos;ils cherchent vraiment.
              </p>
            </li>
            <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 snap-start flex-shrink-0 w-[82vw] sm:w-auto hover:shadow-lg hover:border-amber-400/40 motion-safe:transition-all motion-safe:duration-300 motion-safe:hover:-translate-y-1">
              <span className="text-3xl font-bold text-amber-400" aria-hidden="true">3</span>
              <p className="font-semibold text-foreground">Ride en communauté</p>
              <p className="text-sm text-muted-foreground">
                Tu échanges, tu organises ta session et tu gardes l&apos;esprit glisse sans exposer les spots sensibles.
              </p>
            </li>
          </ol>
        </section>

        {/* Modules principaux */}
        <HomeFeatureCarousel />

        {/* Pourquoi Blob ? — brand story, composant serveur, 0 JS client */}
        {/* border-l-amber-400 : signature visuelle de marque, cohérente avec le séparateur hero */}
        <section aria-labelledby="why-blob" className="rounded-xl border border-border border-l-4 border-l-amber-400 bg-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-amber-400" aria-hidden="true" />
            <h2 id="why-blob" className="text-2xl font-semibold tracking-tight text-foreground">
              Pourquoi Blob ?
            </h2>
          </div>
          <p className="text-base text-muted-foreground leading-relaxed">
            Blob, c&apos;est une communauté surf &amp; kite vivante dans le Médoc Atlantique : elle
            connecte les bonnes personnes selon les envies, les niveaux et les sessions. Riders, pros,
            débutants ou confirmés, chacun peut trouver sa place sans exposer les spots sensibles.
          </p>
        </section>

        {/* CIRCUITS PRINCIPAUX */}
        <section aria-labelledby="choose-circuit" className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-blue-500" aria-hidden="true" />
              <h2 id="choose-circuit" className="text-3xl font-semibold tracking-tight text-foreground">
                Tu rides sur le Médoc Atlantique ?
              </h2>
            </div>
            <p className="text-base text-muted-foreground">Deux façons de rejoindre la communauté locale.</p>
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
                <CardDescription>Pas besoin d&apos;un pro ? Trouve un rider sur Hourtin, Carcans ou Lacanau et organise la session.</CardDescription>
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
                <CardDescription>Signale que tu cherches un cours. Les pros locaux du Médoc te répondent.</CardDescription>
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

        {/* Mobile community highlight (hidden on large screens) */}
        <div className="lg:hidden">
          <CommunityHighlight context="home" className="my-4" />
        </div>

        {/* BONS PLANS */}
        <section aria-labelledby="bons-plans" className="space-y-6">
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-amber-500" aria-hidden="true" />
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
                      <CardDescription className="mt-1">Offres exclusives pour les riders du Médoc Atlantique</CardDescription>
                    </div>
                  </div>
                  <Badge className="bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                    Promos
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground mb-4">
                  Profite d&apos;offres exclusives pour les riders du Médoc Atlantique : matériel, spots et hébergements à prix réduits.
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
            <div className="h-1 w-1 rounded-full bg-indigo-500" aria-hidden="true" />
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

      {/* Right community spotlight (very large screens only) */}
      <aside aria-label="Contenu communautaire" className="sticky top-20 hidden 2xl:block">
        <CommunitySpotlight variant="community" />
      </aside>
    </div>
  );
}
