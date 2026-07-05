import Image from 'next/image';
import { BlobosphereArticleLink, BlobosphereSignupLink } from '@/components/blobosphere/BlobosphereAnalyticsLink';
import { BlobBadge } from '@/components/blob/BlobBadge';
import { BlobButton } from '@/components/blob/BlobButton';
import { HomeFooter } from '@/components/home/HomeFooter';
import { HomeHeader } from '@/components/home/HomeHeader';
import { loadBlobospherePreviews, type BlobosphereArticlePreview } from '@/lib/blobosphere/loadBlobospherePreviews';
import { cn } from '@/lib/utils';
import { AlertCircle, ArrowRight, BookOpen, Heart, Leaf, Sparkles, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { CommunityHighlight } from '@/components/community/CommunityHighlight';
import Link from 'next/link';
import { blobosphereTopics, type BlobosphereTopicSlug } from './static';

type TopicFilterValue = BlobosphereTopicSlug | 'all';

// Map des icônes Lucide pour chaque topic
const topicIconsLucide: Record<BlobosphereTopicSlug | 'all', typeof Sparkles> = {
  all: Sparkles,
  surf: BookOpen,
  kitesurf: Heart,
  communaute: Users,
  impact: Leaf,
};

const topicFilters = [
  { slug: 'all' as TopicFilterValue, label: 'Tous les sujets', description: 'Vue globale des publications.' },
  ...blobosphereTopics.map((topic) => ({
    slug: topic.slug as TopicFilterValue,
    label: topic.label,
    description: topic.description,
  })),
] as const;

const topicMap = new Map(blobosphereTopics.map((topic) => [topic.slug, topic]));

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Blobosphère · Guides surf et kitesurf Médoc Atlantique',
  description:
    "Guides surf et kitesurf pour débuter dans le Médoc Atlantique, choisir son matériel, rider avec prudence et rejoindre la communauté Blob.",
  alternates: { canonical: 'https://blobsurf.com/blobosphere' },
  openGraph: {
    title: 'Blobosphère · Guides surf et kitesurf Médoc Atlantique',
    description:
      "Conseils locaux, sécurité, matériel et communauté pour pratiquer surf et kitesurf sans exposer les spots sensibles.",
    url: 'https://blobsurf.com/blobosphere',
    type: 'website',
  },
};

type BlobospherePageProps = {
  searchParams?: Promise<{ topic?: string }>;
};

function isBlobosphereTopic(value?: string): value is BlobosphereTopicSlug {
  if (!value) {
    return false;
  }
  return blobosphereTopics.some((topic) => topic.slug === value);
}

function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default async function BlobospherePage({ searchParams }: BlobospherePageProps) {
  const resolvedSearchParams = await searchParams;
  const activeTopic: TopicFilterValue = isBlobosphereTopic(resolvedSearchParams?.topic) ? resolvedSearchParams!.topic : 'all';
  const allArticles = await loadBlobospherePreviews();
  const filteredArticles = activeTopic === 'all' ? allArticles : allArticles.filter((a) => a.topic === activeTopic);

  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Blobosphère - Blob',
    description: metadata.description,
    hasPart: allArticles.map((article) => ({
      '@type': 'Article',
      headline: article.title,
      description: article.excerpt,
      datePublished: article.publishedAt,
      inLanguage: 'fr-FR',
      about: topicMap.get(article.topic as BlobosphereTopicSlug)?.label,
      url: `https://blobsurf.com/blobosphere/${article.slug}`,
    })),
    audience: {
      '@type': 'Audience',
      audienceType: ['Riders', 'Professionnels', 'Assistants IA'],
    },
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(collectionJsonLd) }}
        suppressHydrationWarning
      />
      <HomeHeader />

      <section className="-mx-4 bg-blob-black text-white sm:-mx-6 lg:-mx-8">
        <div className="relative min-h-[560px] overflow-hidden sm:min-h-[620px] lg:min-h-[680px]">
          <Image
            src="/videos/hero-poster.webp"
            alt=""
            fill
            priority
            className="object-cover object-center"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-blob-black/82 via-blob-black/36 to-blob-black/92" aria-hidden />

          <div className="relative z-10 flex min-h-[560px] flex-col justify-end px-4 pb-10 pt-28 sm:min-h-[620px] sm:px-8 sm:pb-14 lg:min-h-[680px] lg:px-14 xl:px-20">
            <div className="max-w-4xl space-y-6">
              <div className="flex flex-wrap gap-2">
                <BlobBadge variant="yellow" brandMark>Blobosphère</BlobBadge>
                <BlobBadge variant="outline">Surf & kite</BlobBadge>
                <BlobBadge variant="outline">Sécurité</BlobBadge>
                <BlobBadge variant="outline">Médoc Atlantique</BlobBadge>
              </div>

              <div className="space-y-4">
                <p className="font-display text-5xl leading-none text-blob-yellow sm:text-6xl">
                  Guides Blob
                </p>
                <h1 className="max-w-3xl text-4xl font-black uppercase leading-[0.95] text-white sm:text-6xl lg:text-7xl">
                  Blobosphère
                </h1>
                <p className="max-w-2xl text-base leading-7 text-white/78 sm:text-lg">
                  Des guides courts pour choisir ton matériel, progresser avec prudence et rejoindre des riders sans exposer les spots sensibles.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <BlobButton asChild size="lg" variant="primaryYellow" className="w-full sm:w-auto">
                  <BlobosphereSignupLink href="/register?intent=blobosphere">Créer un compte</BlobosphereSignupLink>
                </BlobButton>
                <BlobButton asChild size="lg" variant="outlineLight" className="w-full sm:w-auto">
                  <Link href="/login">Se connecter</Link>
                </BlobButton>
                <BlobButton asChild size="lg" variant="outlineLight" className="w-full sm:w-auto">
                  <Link href="/">Accueil</Link>
                </BlobButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="topics-title" className="-mx-4 bg-blob-sand px-4 py-10 text-blob-black sm:-mx-6 sm:px-6 sm:py-14 lg:-mx-8 lg:px-10 xl:px-14">
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="max-w-3xl space-y-3">
            <div className="h-1 w-14 bg-blob-yellow" />
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blob-black/58">Rubriques</p>
            <h2 id="topics-title" className="text-3xl font-black uppercase leading-tight text-blob-black sm:text-4xl">
              Choisis un thème
            </h2>
            <p className="text-sm leading-6 text-blob-black/70 sm:text-base">
              Matériel, environnement, santé, communauté : chaque rubrique reste claire, utile et pensée pour la session suivante.
            </p>
          </div>
          <TopicCardList activeTopic={activeTopic} />
          <TopicFilter activeTopic={activeTopic} />
        </div>
      </section>

      <section aria-labelledby="articles-title" className="-mx-4 bg-white px-4 py-10 text-blob-black sm:-mx-6 sm:px-6 sm:py-14 lg:-mx-8 lg:px-10 xl:px-14 dark:bg-[hsl(220_14%_12%)] dark:text-white">
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="h-1 w-14 bg-blob-yellow" />
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blob-black/58 dark:text-white/55">Articles</p>
              <h2 id="articles-title" className="text-3xl font-black uppercase leading-tight text-blob-black sm:text-4xl dark:text-white">
                {activeTopic === 'all' ? 'Sélection Blobosphère' : topicMap.get(activeTopic)?.label}
              </h2>
              <p className="text-sm leading-6 text-blob-black/70 sm:text-base dark:text-white/68">
                Des lectures rapides pour préparer une sortie, choisir un cap et garder la communauté au centre.
              </p>
            </div>
            <BlobButton asChild variant="outlineDark" size="sm">
              <Link href="/register?intent=matching">Trouver un binôme</Link>
            </BlobButton>
          </div>

          {filteredArticles.length === 0 ? (
            <div className="rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 p-5 text-blob-black">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm font-medium leading-6">
                  Aucun article publié pour cette rubrique pour l&apos;instant. Reviens aux autres sujets ou explore le matching Blob.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredArticles.map((article) => {
                const topic = topicMap.get(article.topic as BlobosphereTopicSlug);
                return (
                  <ArticleCard
                    key={article.slug}
                    article={article}
                    topicLabel={topic?.label ?? article.topic}
                  />
                );
              })}
            </div>
          )}

          <CommunityHighlight context="blobosphere" />
        </div>
      </section>

      <HomeFooter />
    </div>
  );
}

function TopicFilter({ activeTopic }: { activeTopic: TopicFilterValue }) {
  return (
    <div className="flex flex-wrap gap-2">
      {topicFilters.map((topic) => {
        const href = topic.slug === 'all' ? '/blobosphere' : `/blobosphere?topic=${topic.slug}`;
        const isActive = topic.slug === activeTopic;
        const IconComponent = topicIconsLucide[topic.slug];
        return (
          <Link
            key={topic.slug}
            href={href}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-sm border-2 px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow',
              isActive
                ? 'border-blob-black bg-blob-yellow text-blob-black'
                : 'border-blob-black/30 bg-white text-blob-black hover:border-blob-black dark:border-white/25 dark:bg-white/8 dark:text-white dark:hover:border-white',
            )}
            aria-current={isActive ? 'true' : undefined}
          >
            <IconComponent className="h-4 w-4" />
            {topic.label}
          </Link>
        );
      })}
    </div>
  );
}

function TopicCardList({ activeTopic }: { activeTopic: TopicFilterValue }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {blobosphereTopics.map((topic) => {
        const href = `/blobosphere?topic=${topic.slug}`;
        const isActive = topic.slug === activeTopic;
        const IconComponent = topicIconsLucide[topic.slug as BlobosphereTopicSlug];
        return (
          <Link
            key={topic.slug}
            href={href}
            className={cn(
              'group min-h-36 rounded-sm border-2 p-5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow motion-safe:hover:-translate-y-1',
              isActive
                ? 'border-blob-black bg-blob-yellow text-blob-black'
                : 'border-blob-sand-deep bg-white text-blob-black hover:border-blob-yellow dark:border-white/10 dark:bg-white/8 dark:text-white dark:hover:border-blob-yellow',
            )}
            aria-current={isActive ? 'true' : undefined}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className={cn('rounded-sm border-2 p-1.5', isActive ? 'border-blob-black bg-blob-black text-white' : 'border-blob-black bg-blob-yellow text-blob-black')}>
                    <IconComponent className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-black uppercase tracking-wide">
                    {topic.label}
                  </p>
                </div>
                <p className={cn('text-sm leading-6', isActive ? 'text-blob-black/78' : 'text-blob-black/68 dark:text-white/65')}>{topic.description}</p>
              </div>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function ArticleCard({
  article,
  topicLabel,
}: {
  article: BlobosphereArticlePreview;
  topicLabel: string;
}) {
  const href = `/blobosphere/${article.slug}`;
  const IconComponent = topicIconsLucide[article.topic as BlobosphereTopicSlug] || BookOpen;

  return (
    <article id={article.slug} className="h-full">
      <div className="group flex h-full flex-col rounded-sm border-2 border-blob-sand-deep bg-blob-sand text-blob-black transition-all duration-200 hover:border-blob-yellow hover:bg-white dark:border-white/10 dark:bg-white/8 dark:text-white dark:hover:border-blob-yellow">
        <div className="flex items-center justify-between gap-3 border-b-2 border-blob-sand-deep px-5 py-4 dark:border-white/10">
          <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
              <IconComponent className="h-4 w-4" />
            </span>
            {topicLabel}
          </div>
          <span className="shrink-0 text-xs font-bold text-blob-black/56 dark:text-white/55">{article.readingTime}</span>
        </div>

        <div className="flex flex-1 flex-col p-5">
          <div className="flex-1 space-y-3">
            <h3 className="text-xl font-black uppercase leading-tight text-blob-black transition-colors group-hover:text-blob-yellow-dark dark:text-white dark:group-hover:text-blob-yellow">
              {article.title}
            </h3>
            <p className="text-sm leading-6 text-blob-black/70 dark:text-white/65">{article.excerpt}</p>
          </div>

          {article.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <BlobBadge key={tag} variant="outline" size="sm">
                  {tag}
                </BlobBadge>
              ))}
            </div>
          )}

          <BlobButton
            asChild
            size="sm"
            variant="dark"
            className="mt-6 w-full"
          >
            <BlobosphereArticleLink href={href} contentId={article.slug} className="inline-flex items-center justify-center gap-2">
              Lire l&apos;article
              <ArrowRight className="h-4 w-4" aria-hidden />
            </BlobosphereArticleLink>
          </BlobButton>
        </div>
      </div>
    </article>
  );
}
