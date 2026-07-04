import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BlobosphereArticleLink, BlobosphereSignupLink } from '@/components/blobosphere/BlobosphereAnalyticsLink';
import { loadBlobospherePreviews, type BlobosphereArticlePreview } from '@/lib/blobosphere/loadBlobospherePreviews';
import { cn } from '@/lib/utils';
import { AlertCircle, BookOpen, Heart, Leaf, Sparkles, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { CommunitySpotlight } from '@/components/community/CommunitySpotlight';
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
  { slug: 'all' as TopicFilterValue, label: 'Tous les sujets', icon: '✨', description: 'Vue globale des publications.' },
  ...blobosphereTopics.map((topic) => ({
    slug: topic.slug as TopicFilterValue,
    label: topic.label,
    icon: topic.icon,
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
    <div className="pb-12 xl:grid xl:grid-cols-[220px,1fr,220px] xl:gap-6">
      {/* Left community spotlight (desktop only) */}
      <aside aria-label="Contenu communautaire" className="sticky top-20 hidden xl:block">
        <CommunitySpotlight variant="partners" />
      </aside>

      <div className="space-y-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(collectionJsonLd) }}
        suppressHydrationWarning
      />
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-600 via-blue-600 to-cyan-500 px-6 py-12 text-white shadow-xl sm:px-10 lg:py-16">
        {/* Blur effects animés */}
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-white/10 blur-3xl" />

        <div className="relative z-10 space-y-8">
          <div className="flex flex-wrap gap-3">
            <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30 border-0">Blobosphère</Badge>
            <Badge variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10">Surf · Kite</Badge>
            <Badge variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10">Équipement · Environnement · Santé</Badge>
            <Badge variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10">Sécurité</Badge>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-2.5 backdrop-blur-sm">
              <Sparkles className="h-7 w-7" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Le guide pour t&apos;équiper, rider responsable et rester en forme
            </h1>
          </div>

          <p className="text-lg text-white/90">
            Des guides courts pour débuter autour du Médoc Atlantique, bien choisir ton matériel,
            comprendre la sécurité et trouver des partenaires sans exposer les spots sensibles.
          </p>

          <div className="flex flex-wrap gap-4">
            <Button asChild size="lg" className="bg-white text-sky-700 hover:bg-white/90 shadow-lg hover:shadow-xl transition-all border-0">
              <BlobosphereSignupLink href="/register?intent=blobosphere">Créer un compte</BlobosphereSignupLink>
            </Button>
            <Button asChild variant="outline" size="lg" className="border-2 border-white/40 bg-transparent text-white hover:bg-white/10">
              <Link href="/login">Déjà membre ? Se connecter</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="bg-transparent text-white hover:bg-white/10">
              <Link href="/">← Retour à l&apos;accueil</Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="topics-title" className="space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-sky-700 dark:text-sky-400">Rubriques</p>
          <h2 id="topics-title" className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-slate-100">
            Choisis un thème
          </h2>
          <p className="text-base text-muted-foreground">
            Commence par Équipement, Environnement ou Santé. Les interviews arrivent très vite.
          </p>
        </div>
        <TopicCardList activeTopic={activeTopic} />
        <TopicFilter activeTopic={activeTopic} />
      </section>

      <section aria-labelledby="articles-title" className="space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-sky-700 dark:text-sky-400">Articles</p>
          <h2 id="articles-title" className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-slate-100">
            Sélection {activeTopic === 'all' ? 'Blobosphère' : topicMap.get(activeTopic)?.label}
          </h2>
          <p className="text-base text-muted-foreground">
            Des guides courts et concrets, écrits avec la communauté : sécurité, matériel, spots et progression autour du Médoc Atlantique.
          </p>
        </div>
        {filteredArticles.length === 0 ? (
          <Card className="border-2 border-dashed border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
            <CardContent className="py-10">
              <div className="flex items-start justify-center gap-3">
                <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-base text-amber-700 dark:text-amber-300">
                  Aucun article publié pour cette rubrique pour l&apos;instant. Sélectionne &quot;Tous les sujets&quot; ou publie un nouveau guide via l&apos;admin.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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
      </section>

      {/* Mobile community highlight (hidden on large screens) */}
      <div className="lg:hidden">
        <CommunityHighlight context="blobosphere" className="my-4" />
      </div>
      </div>

      {/* Right community spotlight (very large screens only) */}
      <aside aria-label="Contenu communautaire" className="sticky top-20 hidden 2xl:block">
        <CommunitySpotlight variant="community" />
      </aside>
    </div>
  );
}

function TopicFilter({ activeTopic }: { activeTopic: TopicFilterValue }) {
  return (
    <div className="flex flex-wrap gap-3">
      {topicFilters.map((topic) => {
        const href = topic.slug === 'all' ? '/blobosphere' : `/blobosphere?topic=${topic.slug}`;
        const isActive = topic.slug === activeTopic;
        const IconComponent = topicIconsLucide[topic.slug];
        return (
          <Link
            key={topic.slug}
            href={href}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold transition-all duration-200 hover:shadow-md',
              isActive
                ? 'border-sky-600 bg-sky-600 text-white shadow-md'
                : 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-sky-500 dark:hover:bg-sky-950',
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
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {blobosphereTopics.map((topic) => {
        const href = `/blobosphere?topic=${topic.slug}`;
        const isActive = topic.slug === activeTopic;
        const IconComponent = topicIconsLucide[topic.slug as BlobosphereTopicSlug];
        return (
          <Link
            key={topic.slug}
            href={href}
            className={cn(
              'group rounded-2xl border-2 p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg',
              isActive
                ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-900/20'
                : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-500 dark:hover:bg-sky-950/30',
            )}
            aria-current={isActive ? 'true' : undefined}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-sky-100 p-1.5 dark:bg-sky-900/30">
                    <IconComponent className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                  </div>
                  <p className="text-sm font-semibold text-sky-700 dark:text-sky-300">
                    {topic.label}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">{topic.description}</p>
              </div>
              <span aria-hidden className="text-sky-700 transition-transform group-hover:translate-x-1 dark:text-sky-300">→</span>
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
    <article
      id={article.slug}
      className="group flex h-full flex-col rounded-2xl border-2 border-transparent bg-white p-6 shadow-sm transition-all duration-200 hover:border-sky-300 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-500"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1.5 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
          <div className="rounded bg-sky-100 p-1 dark:bg-sky-900/50">
            <IconComponent className="h-3 w-3 text-sky-700 dark:text-sky-300" />
          </div>
          <span className="font-semibold">{topicLabel}</span>
        </div>
        <span className="ml-auto text-muted-foreground">{article.readingTime}</span>
      </div>

      <div className="mt-5 flex-1 space-y-3">
        <h3 className="text-xl font-semibold text-gray-900 transition-colors group-hover:text-sky-700 dark:text-slate-100 dark:group-hover:text-sky-400">
          {article.title}
        </h3>
        <p className="text-sm text-muted-foreground">{article.excerpt}</p>
      </div>

      {article.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-6">
        <Button
          asChild
          size="sm"
          className="w-full bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md transition-all hover:from-sky-700 hover:to-blue-700 hover:shadow-lg"
        >
          <BlobosphereArticleLink href={href} contentId={article.slug} className="inline-flex items-center justify-center gap-2">
            Lire l&apos;article
            <span aria-hidden="true">→</span>
          </BlobosphereArticleLink>
        </Button>
      </div>
    </article>
  );
}
