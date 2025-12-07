import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
      <div className="space-y-14">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-sky-50 via-white to-blue-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900 px-6 py-12 shadow-sm sm:px-10 lg:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-sky-100 dark:bg-slate-800/40 blur-2xl md:h-60 md:w-60"
        />
        <div className="relative flex flex-col gap-6 animate-in fade-in-50 duration-500">
          <Badge variant="secondary" className="w-fit animate-in fade-in-50 duration-500">Communauté Surf & Kite</Badge>
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              La communauté Surf & Kite, partenaires de ride et pros près de toi
            </h1>
            <p className="text-lg text-muted-foreground">
              Matching simple, messagerie intégrée et un parcours clair pour organiser tes sessions. Deux circuits au choix : ride en binôme ou cours avec un pro.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="outline" size="lg" className="transition hover:-translate-y-0.5">
              <Link href="/register">Créer un compte</Link>
            </Button>
            <Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Se connecter
            </Link>
          </div>
        </div>
      </section>

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
          <Card className="group h-full transition hover:-translate-y-0.5 hover:shadow-xl animate-in fade-in-50 duration-500" style={{ animationDelay: '120ms' }}>
            <CardHeader className="space-y-2">
              <CardTitle className="flex items-center gap-3 text-2xl">
                <span aria-hidden className="transition group-hover:scale-110">🤝</span> Ride à deux
              </CardTitle>
              <CardDescription>Pas besoin d’un pro ? Trouve ton binôme et organise la session.</CardDescription>
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
          <Card className="group h-full transition hover:-translate-y-0.5 hover:shadow-xl animate-in fade-in-50 duration-500" style={{ animationDelay: '220ms' }}>
            <CardHeader className="space-y-2">
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
