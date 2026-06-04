import { HomeHeader } from '@/components/home/HomeHeader';
import { HomeHeroSplit } from '@/components/home/HomeHeroSplit';
import { HomeYellowBar } from '@/components/home/HomeYellowBar';
import { HomeConnectionSteps } from '@/components/home/HomeConnectionSteps';
import type { Metadata } from 'next';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Blob · Communauté Surf & Kite du Médoc Atlantique',
  description:
    'Trouve un partenaire de session, réserve un cours et découvre les bons plans surf et kite sur Hourtin, Carcans et Lacanau.',
};

export default function Home() {
  return (
    <div>
      {/* Header premium horizontal — sticky, full-bleed */}
      <HomeHeader />

      {/* Bloc full-bleed : hero + barre jaune brush, collés sans gap */}
      <HomeHeroSplit />
      <HomeYellowBar />

      {/* Sections de corps — espacées normalement */}
      <div className="space-y-8 mt-8 sm:mt-10">

        {/* "Blob te connecte" — 3 étapes */}
        <HomeConnectionSteps />

        {/* Pourquoi Blob ? */}
        <section
          aria-labelledby="why-blob"
          className="rounded-xl border border-border border-l-4 border-l-amber-400 bg-card p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-amber-400" aria-hidden="true" />
            <h2
              id="why-blob"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Pourquoi Blob ?
            </h2>
          </div>
          <p className="text-base text-muted-foreground leading-relaxed">
            Blob, c&apos;est une communauté surf &amp; kite vivante dans le Médoc Atlantique.
            Elle aide riders, pros, débutants et confirmés à se trouver, à partager les bons
            conseils et à préserver l&apos;esprit glisse.
          </p>
        </section>

      </div>
    </div>
  );
}
