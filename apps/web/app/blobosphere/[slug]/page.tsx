import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BlobBadge } from '@/components/blob/BlobBadge';
import { BlobButton } from '@/components/blob/BlobButton';
import { SafeMdxContent } from '@/components/blobosphere/SafeMdxContent';
import { HomeFooter } from '@/components/home/HomeFooter';
import { HomeHeader } from '@/components/home/HomeHeader';
import { loadPublishedBlobosphereArticleBySlug } from '@/lib/blobosphere/loadBlobosphereArticle';
import { loadBlobosphereSitemapEntries } from '@/lib/blobosphere/loadBlobosphereSitemapEntries';
import { blobosphereTopics } from '../static';

type BlobosphereArticlePageProps = {
  params: Promise<{ slug: string }>;
};

const topicMap = new Map(blobosphereTopics.map((topic) => [topic.slug, topic]));

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

function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function getArticleHeroImage(coverImage: string | null): string {
  return coverImage?.startsWith('/') ? coverImage : '/videos/hero-poster.webp';
}

export async function generateStaticParams() {
  const entries = await loadBlobosphereSitemapEntries();
  return entries.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: BlobosphereArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadPublishedBlobosphereArticleBySlug(slug);
  if (!article) {
    return {};
  }

  const siteUrl = getSiteUrl();
  const url = `${siteUrl}/blobosphere/${encodeURIComponent(article.slug)}`;

  return {
    title: `${article.title} · Blobosphère`,
    description: article.excerpt,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.excerpt,
      url,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt ?? undefined,
      images: article.coverImage ? [{ url: article.coverImage, alt: article.title }] : undefined,
    },
    twitter: {
      card: article.coverImage ? 'summary_large_image' : 'summary',
      title: article.title,
      description: article.excerpt,
      images: article.coverImage ? [article.coverImage] : undefined,
    },
  };
}

export default async function BlobosphereArticlePage({ params }: BlobosphereArticlePageProps) {
  const { slug } = await params;
  const article = await loadPublishedBlobosphereArticleBySlug(slug);
  if (!article) {
    notFound();
  }

  const topic = topicMap.get(article.category);
  const siteUrl = getSiteUrl();
  const url = `${siteUrl}/blobosphere/${encodeURIComponent(article.slug)}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt ?? article.publishedAt,
    inLanguage: 'fr-FR',
    mainEntityOfPage: url,
    url,
    image: article.coverImage ?? undefined,
    articleSection: topic?.label ?? article.category,
    keywords: article.tags,
    publisher: {
      '@type': 'Organization',
      name: 'Blob',
      url: siteUrl,
    },
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <HomeHeader />

      <article>
        <section className="-mx-4 bg-blob-black text-white sm:-mx-6 lg:-mx-8">
          <div className="relative min-h-[520px] overflow-hidden sm:min-h-[600px] lg:min-h-[660px]">
            <Image
              src={getArticleHeroImage(article.coverImage)}
              alt=""
              fill
              priority
              className="object-cover object-center"
              sizes="100vw"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-blob-black/84 via-blob-black/42 to-blob-black/94" aria-hidden />

            <div className="relative z-10 flex min-h-[520px] flex-col justify-end px-4 pb-10 pt-28 sm:min-h-[600px] sm:px-8 sm:pb-14 lg:min-h-[660px] lg:px-14 xl:px-20">
              <div className="max-w-4xl space-y-6">
                <nav aria-label="Fil d’Ariane" className="text-xs font-bold uppercase tracking-widest text-white/72">
                  <ol className="flex flex-wrap items-center gap-2">
                    <li>
                      <Link href="/" className="hover:text-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow">
                        Blob
                      </Link>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li>
                      <Link href="/blobosphere" className="hover:text-blob-yellow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow">
                        Blobosphère
                      </Link>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li className="text-white">{topic?.label ?? article.category}</li>
                  </ol>
                </nav>

                <div className="flex flex-wrap items-center gap-2">
                  <BlobBadge variant="yellow" brandMark>{topic?.label ?? article.category}</BlobBadge>
                  <BlobBadge variant="outline">
                    <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
                  </BlobBadge>
                  <BlobBadge variant="outline">{article.readingTime}</BlobBadge>
                </div>

                <div className="space-y-4">
                  <p className="font-display text-5xl leading-none text-blob-yellow sm:text-6xl">
                    Blobosphère
                  </p>
                  <h1 className="max-w-4xl text-4xl font-black uppercase leading-[0.95] text-white sm:text-5xl lg:text-6xl">
                    {article.title}
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-white/78 sm:text-lg">{article.excerpt}</p>
                </div>

                {article.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {article.tags.map((tag) => (
                      <BlobBadge key={tag} variant="outline">
                        {tag}
                      </BlobBadge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="-mx-4 bg-white px-4 py-10 text-blob-black sm:-mx-6 sm:px-6 sm:py-14 lg:-mx-8 lg:px-10 xl:px-14 dark:bg-[hsl(220_14%_12%)] dark:text-white">
          <div className="mx-auto max-w-3xl space-y-9">
            <SafeMdxContent content={article.body} articleSlug={article.slug} />

            <section className="rounded-sm border-2 border-blob-black bg-blob-yellow p-5 text-blob-black">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-black uppercase tracking-wide">Rejoins la communauté Blob</h2>
                  <p className="text-sm leading-6 text-blob-black/72">
                    Crée un profil pour échanger avec des riders et trouver des partenaires sans publier de spot sensible.
                  </p>
                </div>
                <BlobButton asChild variant="yellowSignalDark" size="md" className="w-full sm:w-auto">
                  <Link href={`/register?intent=blobosphere&article=${encodeURIComponent(article.slug)}`}>Créer un compte</Link>
                </BlobButton>
              </div>
            </section>

            <BlobButton asChild variant="outlineDark" size="sm">
              <Link href="/blobosphere">Retour à la Blobosphère</Link>
            </BlobButton>
          </div>
        </section>
      </article>

      <HomeFooter />
    </div>
  );
}
