import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { BlobBadge } from '@/components/blob/BlobBadge';
import { BlobButton } from '@/components/blob/BlobButton';
import { BlobCard } from '@/components/blob/BlobCard';
import { HomeFooter } from '@/components/home/HomeFooter';
import { HomeHeader } from '@/components/home/HomeHeader';
import { loadPublicProList, type PublicProListItem } from '@/lib/pros/loadPublicProProfile';

type ProsIndexPageProps = {
  searchParams?: Promise<{ cursor?: string }>;
};

export const metadata: Metadata = {
  title: 'Moniteurs de surf et kitesurf — Blob',
  description: 'Trouve un moniteur de surf ou de kitesurf diplômé près de chez toi sur Blob.',
};

function groupByCity(items: PublicProListItem[]): [string, PublicProListItem[]][] {
  const byCity = new Map<string, PublicProListItem[]>();
  for (const item of items) {
    const city = item.publicCity ?? 'Autres villes';
    const list = byCity.get(city) ?? [];
    list.push(item);
    byCity.set(city, list);
  }
  return Array.from(byCity.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export default async function ProsIndexPage({ searchParams }: ProsIndexPageProps) {
  const resolvedSearchParams = await searchParams;
  const cursor = resolvedSearchParams?.cursor;
  const { items, nextCursor } = await loadPublicProList(cursor);
  const groups = groupByCity(items);

  return (
    <div className="flex min-h-screen flex-col">
      <HomeHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-widest text-blob-black">
            Moniteurs de surf &amp; kitesurf
          </h1>
          <p className="mt-2 text-sm text-blob-black/70">
            Des moniteurs indépendants diplômés d&apos;État, prêts à t&apos;accompagner.
          </p>
        </div>

        {groups.length === 0 ? (
          <BlobCard mode="sand">
            <p className="text-sm text-blob-black/70">
              Aucun moniteur n&apos;a encore publié sa page publique. Reviens bientôt !
            </p>
          </BlobCard>
        ) : (
          <div className="space-y-6">
            {groups.map(([city, pros]) => (
              <div key={city}>
                <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-blob-black/60">
                  {city}
                </h2>
                <div className="space-y-3">
                  {pros.map((pro) => (
                    <Link key={pro.slug} href={`/pros/${encodeURIComponent(pro.slug)}`}>
                      <BlobCard mode="white" className="transition-colors hover:border-blob-yellow">
                        <div className="flex items-center gap-3">
                          {pro.photoUrl ? (
                            <Image
                              src={pro.photoUrl}
                              alt={pro.businessName}
                              width={48}
                              height={48}
                              className="h-12 w-12 shrink-0 rounded-sm border-2 border-blob-black object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-lg font-black text-blob-black">
                              {pro.businessName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-black uppercase tracking-wide text-blob-black">
                                {pro.businessName}
                              </span>
                              {pro.verified && <BlobBadge variant="dark">Diplômé vérifié</BlobBadge>}
                            </div>
                          </div>
                        </div>
                      </BlobCard>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {nextCursor && (
          <div className="flex justify-center">
            <BlobButton asChild variant="outlineDark">
              <Link href={`/pros?cursor=${encodeURIComponent(nextCursor)}`}>Voir plus</Link>
            </BlobButton>
          </div>
        )}
      </main>

      <HomeFooter />
    </div>
  );
}
