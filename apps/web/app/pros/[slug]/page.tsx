import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BlobBadge } from '@/components/blob/BlobBadge';
import { BlobButton } from '@/components/blob/BlobButton';
import { BlobCard } from '@/components/blob/BlobCard';
import { HomeFooter } from '@/components/home/HomeFooter';
import { HomeHeader } from '@/components/home/HomeHeader';
import { ProPublicProfileViewTracker } from '@/components/pros/ProPublicProfileViewTracker';
import {
  loadPublicProProfile,
  SPORT_LABELS,
  LEVEL_LABELS,
  type PublicProOffer,
} from '@/lib/pros/loadPublicProProfile';

type ProPublicProfilePageProps = {
  params: Promise<{ slug: string }>;
};

function normalizeSiteUrl(value: string): string {
  const parsed = new URL(value.trim());
  return `${parsed.protocol}//${parsed.host}`;
}

function getSiteUrl(): string {
  const fromEnv = process.env.SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fromEnv) {
    return normalizeSiteUrl(fromEnv);
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://blobsurf.com';
  }
  return 'http://localhost:3002';
}

function sportLabel(sport: string): string {
  return SPORT_LABELS[sport] ?? sport;
}

function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

function groupOffersBySport(offers: PublicProOffer[]): [string, PublicProOffer[]][] {
  const bySport = new Map<string, PublicProOffer[]>();
  for (const offer of offers) {
    const list = bySport.get(offer.sport) ?? [];
    list.push(offer);
    bySport.set(offer.sport, list);
  }
  return Array.from(bySport.entries());
}

export async function generateMetadata({ params }: ProPublicProfilePageProps): Promise<Metadata> {
  const { slug } = await params;
  const profile = await loadPublicProProfile(slug);
  if (!profile) {
    return {};
  }

  const siteUrl = getSiteUrl();
  const url = `${siteUrl}/pros/${encodeURIComponent(profile.slug)}`;
  const cityPart = profile.publicCity ? ` à ${profile.publicCity}` : '';
  const title = `${profile.businessName} — Moniteur${cityPart} · Blob`;
  const description =
    profile.bio?.slice(0, 160) ||
    `Réserve un cours avec ${profile.businessName}${cityPart} sur Blob.`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      title,
      description,
      url,
      images: profile.photoUrl ? [{ url: profile.photoUrl, alt: profile.businessName }] : undefined,
    },
    twitter: {
      card: profile.photoUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      images: profile.photoUrl ? [profile.photoUrl] : undefined,
    },
  };
}

export default async function ProPublicProfilePage({ params }: ProPublicProfilePageProps) {
  const { slug } = await params;
  const profile = await loadPublicProProfile(slug);
  if (!profile) {
    notFound();
  }

  const offersBySport = groupOffersBySport(profile.offers);

  return (
    <div className="flex min-h-screen flex-col">
      <ProPublicProfileViewTracker slug={profile.slug} />
      <HomeHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8">
        <BlobCard mode="sand">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {profile.photoUrl ? (
              <Image
                src={profile.photoUrl}
                alt={profile.businessName}
                width={96}
                height={96}
                className="h-24 w-24 shrink-0 rounded-sm border-2 border-blob-black object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-2xl font-black text-blob-black">
                {profile.businessName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-2xl font-black uppercase tracking-widest text-blob-black">
                  {profile.businessName}
                </h1>
                {profile.verified && <BlobBadge variant="dark">Diplômé vérifié</BlobBadge>}
              </div>
              {profile.publicCity && (
                <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-blob-black/70">
                  {profile.publicCity}
                </p>
              )}
              {profile.bio && (
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-blob-black/80">
                  {profile.bio}
                </p>
              )}
            </div>
          </div>
        </BlobCard>

        {offersBySport.length > 0 && (
          <BlobCard mode="white">
            <h2 className="mb-3 text-lg font-black uppercase tracking-widest text-blob-black">
              Cours proposés
            </h2>
            <div className="space-y-4">
              {offersBySport.map(([sport, offers]) => (
                <div key={sport}>
                  <h3 className="text-sm font-black uppercase tracking-wide text-blob-black/70">
                    {sportLabel(sport)}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {offers.map((offer, index) => (
                      <li
                        key={`${offer.sport}-${offer.level}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-blob-black">{offer.title}</p>
                          <p className="text-xs text-blob-black/64">{levelLabel(offer.level)}</p>
                        </div>
                        <span className="shrink-0 text-sm font-black text-blob-black">
                          {offer.hourlyRate.toFixed(0)} €/h
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </BlobCard>
        )}

        <div className="flex justify-center">
          <BlobButton asChild size="lg">
            <Link href="/register?next=/matching">Demander un cours</Link>
          </BlobButton>
        </div>
      </main>

      <HomeFooter />
    </div>
  );
}
