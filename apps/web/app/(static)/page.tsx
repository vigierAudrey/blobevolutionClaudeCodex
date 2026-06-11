import { HomeHeader } from '@/components/home/HomeHeader';
import { HomeHeroSplit } from '@/components/home/HomeHeroSplit';
import { HomeOceanTransition } from '@/components/home/HomeOceanTransition';
import { HomeWhyBlob } from '@/components/home/HomeWhyBlob';
import { HomeFooter } from '@/components/home/HomeFooter';
import type { Metadata } from 'next';

// ISR with 5min revalidation
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Blob · Communauté Surf & Kite du Médoc Atlantique',
  description:
    'Trouve un partenaire de session, demande un cours à un pro et découvre les guides surf et kite sur Hourtin, Carcans et Lacanau.',
};

export default function Home() {
  return (
    <div>
      {/* Ambient background — home only, zero cost on authenticated pages */}
      <div aria-hidden="true" className="home-wallpaper-bg" />

      {/* Header premium horizontal — sticky, full-bleed */}
      <HomeHeader />

      {/* Bloc full-bleed : hero + carrousel + barre jaune intégrée */}
      <HomeHeroSplit />

      {/* Transition légère : fil océan + promesse communautaire */}
      <HomeOceanTransition />

      {/* Pourquoi Blob ? — full-bleed, fond sable, bêta messaging */}
      <div>
        <HomeWhyBlob />
      </div>

      {/* Footer premium — full-bleed, fond noir */}
      <HomeFooter />
    </div>
  );
}
