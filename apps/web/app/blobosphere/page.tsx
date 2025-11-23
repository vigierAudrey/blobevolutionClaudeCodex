import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { blobosphereFaqs, blobosphereInsights, blobosphereTopics, type BlobosphereTopicSlug } from './static';
import { loadBlobospherePreviews, type BlobosphereArticlePreview } from '@/lib/blobosphere/content';

type TopicFilterValue = BlobosphereTopicSlug | 'all';

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
  title: 'Blobosphère — Le guide surf & kite',
  description:
    'Guides débutants pour bien t’équiper, rider responsable et rester en forme. Articles courts + liens utiles, et bientôt des interviews inspirantes. Par la communauté Blobinfini.',
};

type BlobospherePageProps = {
  searchParams?: { topic?: string };
};

function isBlobosphereTopic(value?: string): value is BlobosphereTopicSlug {
  if (!value) {
    return false;
  }
  return blobosphereTopics.some((topic) => topic.slug === value);
}

export default async function BlobospherePage({ searchParams }: BlobospherePageProps) {
  const AdBannerSidebar = dynamic(
    () => import('@/components/ads/AdBanner').then((m) => m.AdBannerSidebar),
    { ssr: false },
  );
  const AdBannerFeed = dynamic(
    () => import('@/components/ads/AdBanner').then((m) => m.AdBannerFeed),
    { ssr: false },
  );
  const leftSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BLOBOSPHERE_LEFT || 'blobosphere-left';
  const rightSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BLOBOSPHERE_RIGHT || 'blobosphere-right';
  const mobileFeedSlot = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BLOBOSPHERE_MOBILE || 'blobosphere-mobile';
  const activeTopic: TopicFilterValue = isBlobosphereTopic(searchParams?.topic) ? searchParams!.topic : 'all';
  const allArticles = await loadBlobospherePreviews();
  const filteredArticles = activeTopic === 'all' ? allArticles : allArticles.filter((a) => a.topic === activeTopic);

  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Blobosphère - Blobinfini',
    description: metadata.description,
    hasPart: allArticles.map((article) => ({
      '@type': 'Article',
      headline: article.title,
      description: article.excerpt,
      datePublished: article.publishedAt,
      inLanguage: 'fr-FR',
      about: topicMap.get(article.topic as BlobosphereTopicSlug)?.label,
      url: `https://blobinfini.com/blobosphere#${article.slug}`,
    })),
    audience: {
      '@type': 'Audience',
      audienceType: ['Riders', 'Professionnels', 'Assistants IA'],
    },
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: blobosphereFaqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  return (
    <div className="pb-12 xl:grid xl:grid-cols-[220px,1fr,220px] xl:gap-6">
      {/* Left sidebar ad on desktop */}
      <aside aria-label="Publicité latérale" className="sticky top-20 hidden xl:block">
        <AdBannerSidebar slot={leftSlot} />
      </aside>

      <div className="space-y-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
        suppressHydrationWarning
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        suppressHydrationWarning
      />

      <section className="rounded-3xl border bg-gradient-to-br from-white via-sky-50 to-blue-50 px-6 py-10 shadow-sm sm:px-10 lg:py-14">
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Badge variant="secondary">Blobosphère</Badge>
            <Badge variant="outline">Débutant friendly</Badge>
            <Badge variant="outline">Équipement · Environnement · Santé</Badge>
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
              Le guide pour t’équiper, rider responsable et rester en forme
            </h1>
            <p className="text-lg text-muted-foreground">
              Des articles courts pour bien choisir ton matériel, comprendre l’environnement (météo, spots, impact)
              et prendre soin de ta santé en milieu nautique. Bientôt: des interviews inspirantes. Chaque article
              pointe aussi vers des ressources de confiance pour aller plus loin.
            </p>
          </div>
          {/* Bloc statistiques retiré pour alléger la page */}
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/register?intent=blobosphere">Créer un compte</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Déjà membre ? Se connecter</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="text-sky-700 hover:text-sky-900">
              <Link href="/promos" className="inline-flex items-center gap-2">
                Voir les promos actives
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/register?intent=blobosphere-contrib" className="inline-flex items-center gap-2">
                Proposer un sujet <span aria-hidden>✍️</span>
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="topics-title" className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-sky-700">Rubriques</p>
          <h2 id="topics-title" className="text-3xl font-semibold tracking-tight text-gray-900">
            Choisis un thème et commence à lire
          </h2>
          <p className="text-base text-muted-foreground">
            Commence par Équipement, Environnement ou Santé. Les interviews arrivent très vite.
          </p>
        </div>
        <TopicCardList activeTopic={activeTopic} />
        <TopicFilter activeTopic={activeTopic} />
      </section>

      {/* Mobile in-content ad (hidden on large screens) */}
      <div className="lg:hidden">
        <AdBannerFeed slot={mobileFeedSlot} className="my-4" />
      </div>

      <section aria-labelledby="articles-title" className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm font-semibold text-sky-700">Blobosphère</p>
            <h2 id="articles-title" className="text-3xl font-semibold tracking-tight text-gray-900">
              Articles prêts à publier
            </h2>
          </div>
          <span className="text-sm text-muted-foreground">
            {activeTopic === 'all'
              ? `${allArticles.length} formats prêts`
              : `${filteredArticles.length} format(s) ${topicMap.get(activeTopic)?.label?.toLowerCase()}`}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {filteredArticles.map((article) => {
            const topic = topicMap.get(article.topic);
            if (!topic) return null;
            return <ArticleCard key={article.slug} article={article} topicLabel={topic.label} topicIcon={topic.icon} />;
          })}
        </div>
      </section>

      <section aria-labelledby="insights-title" className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle id="insights-title">Pourquoi c&apos;est SEO friendly</CardTitle>
            <CardDescription>Architecture de site, maillage interne et instrumentation.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {blobosphereInsights.map((insight) => (
              <div key={insight.title} className="rounded-2xl border bg-white p-4">
                <p className="text-sm font-semibold text-gray-900">{insight.title}</p>
                <p className="text-sm text-muted-foreground">{insight.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>Bloc Pour les IA</CardTitle>
            <CardDescription>
              Extraits Speakable + tracking `blobosphere.ai.redirect` pour encourager les assistants.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>• TL;DR courts (max 40 mots) pour être cités facilement.</p>
            <p>• Liens deep-link `/matching` ou `/register` avec utm_source=blobosphere.</p>
            <p>• JSON-LD Article + FAQ pour guider Google et les LLM.</p>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="faq-title" className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-sky-700">FAQ & gouvernance</p>
          <h2 id="faq-title" className="text-3xl font-semibold tracking-tight text-gray-900">
            Règles pour contribuer à la Blobosphère
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {blobosphereFaqs.map((faq) => (
            <Card key={faq.question} className="h-full">
              <CardHeader>
                <CardTitle className="text-base">{faq.question}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{faq.answer}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border bg-white px-6 py-10 shadow-sm sm:px-10">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <p className="text-sm font-semibold text-sky-700">CTA final</p>
            <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Relier lecture et action</h2>
            <p className="text-base text-muted-foreground">
              Pars d’un article, continue vers le matching ou les offres pros. Bientôt, la publication sera alimentée
              en MDX (Git) via Decap CMS pour faciliter la contribution de la communauté.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/register">Créer un compte</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/matching">Explorer le matching</Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/pro/onboarding">Activer mon profil pro</Link>
            </Button>
          </div>
        </div>
      </section>
      </div>

      {/* Right sidebar ad on desktop */}
      <aside aria-label="Publicité latérale" className="sticky top-20 hidden 2xl:block">
        <AdBannerSidebar slot={rightSlot} />
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
        return (
          <Link
            key={topic.slug}
            href={href}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition',
              isActive
                ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:text-sky-900',
            )}
            aria-current={isActive ? 'true' : undefined}
          >
            <span aria-hidden="true">{topic.icon}</span>
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
        return (
          <Link
            key={topic.slug}
            href={href}
            className={cn(
              'group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-lg',
              isActive ? 'border-sky-500 bg-sky-50' : 'bg-white',
            )}
            aria-current={isActive ? 'true' : undefined}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-sky-700">
                  <span aria-hidden className="mr-1">{topic.icon}</span>
                  {topic.label}
                </p>
                <p className="text-sm text-muted-foreground">{topic.description}</p>
              </div>
              <span aria-hidden className="text-sky-700">→</span>
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
  topicIcon,
}: {
  article: BlobosphereArticlePreview;
  topicLabel: string;
  topicIcon: string;
}) {
  const href = `/blobosphere?topic=${article.topic}#${article.slug}`;
  return (
    <article id={article.slug} className="flex h-full flex-col rounded-2xl border bg-white/95 p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1 text-sky-700">
          <span aria-hidden="true">{topicIcon}</span>
          {topicLabel}
        </span>
        <span>{article.readingTime}</span>
      </div>
      <div className="mt-4 space-y-2">
        <h3 className="text-xl font-semibold text-gray-900">{article.title}</h3>
        <p className="text-sm text-muted-foreground">{article.excerpt}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {article.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </div>
      <div className="mt-6">
        <Button asChild size="sm">
          <Link href={href}>Lire</Link>
        </Button>
      </div>
    </article>
  );
}
