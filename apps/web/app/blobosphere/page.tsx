import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { loadBlobospherePreviews, type BlobosphereArticlePreview } from '@/lib/blobosphere/loadBlobospherePreviews';
import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { blobosphereTopics, type BlobosphereTopicSlug } from './static';

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
    'Guides débutants pour bien t’équiper, rider responsable et rester en forme. Articles courts + liens utiles, et bientôt des interviews inspirantes. Par la communauté BlobConnect.',
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
    name: 'Blobosphère - BlobConnect',
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
      <section className="rounded-3xl border bg-gradient-to-br from-white via-sky-50 to-blue-50 px-6 py-10 shadow-sm sm:px-10 lg:py-14">
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Badge variant="secondary">Blobosphère</Badge>
            <Badge variant="outline">Surf · Kite</Badge>
            <Badge variant="outline">Équipement · Environnement · Santé</Badge>
            <Badge variant="outline">Sécurité</Badge>
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
              Le guide pour t’équiper, rider responsable et rester en forme
            </h1>
            <p className="text-lg text-muted-foreground">
              Des articles courts pour bien choisir ton matériel, comprendre l’environnement (météo, spots, impact)
              et prendre soin de ta santé. Bientôt: des interviews inspirantes. Chaque article
              pointe aussi vers des ressources de confiance pour aller plus loin.
            </p>
            <div>
              <Button asChild variant="outline">
                <Link href="/">← Retour à l’accueil</Link>
              </Button>
            </div>
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
          </div>
        </div>
      </section>

      <section aria-labelledby="topics-title" className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-sky-700">Rubriques</p>
          <h2 id="topics-title" className="text-3xl font-semibold tracking-tight text-gray-900">
            Choisis un thème
          </h2>
          <p className="text-base text-muted-foreground">
            Commence par Équipement, Environnement ou Santé. Les interviews arrivent très vite.
          </p>
        </div>
        <TopicCardList activeTopic={activeTopic} />
        <TopicFilter activeTopic={activeTopic} />
      </section>

      <section aria-labelledby="articles-title" className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-semibold text-sky-700">Articles</p>
          <h2 id="articles-title" className="text-3xl font-semibold tracking-tight text-gray-900">
            Sélection {activeTopic === 'all' ? 'Blobosphère' : topicMap.get(activeTopic)?.label}
          </h2>
          <p className="text-base text-muted-foreground">
            Les guides publiés sont tirés directement des fichiers MDX (`apps/web/content/blobosphere`). Les brouillons restent cachés tant qu’ils ne sont pas publiés.
          </p>
        </div>
        {filteredArticles.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center">
              <p className="text-base text-muted-foreground">
                Aucun article publié pour cette rubrique pour l’instant. Sélectionne “Tous les sujets” ou publie un nouveau guide via l’admin.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredArticles.map((article) => {
              const topic = topicMap.get(article.topic as BlobosphereTopicSlug);
              return (
                <ArticleCard
                  key={article.slug}
                  article={article}
                  topicLabel={topic?.label ?? article.topic}
                  topicIcon={topic?.icon ?? '📘'}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Mobile in-content ad (hidden on large screens) */}
      <div className="lg:hidden">
        <AdBannerFeed slot={mobileFeedSlot} className="my-4" />
      </div>

      <section aria-labelledby="contrib-title" className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-sky-700">Participer</p>
          <h2 id="contrib-title" className="text-3xl font-semibold tracking-tight text-gray-900">
            Comment proposer un article ?
          </h2>
          <p className="text-base text-muted-foreground">
            Toute contribution passe par le profil BlobConnect. Nous étudions chaque sujet avant publication pour
            garantir le respect du RGPD et de la charte éditoriale.
          </p>
        </div>
        <Card className="bg-white">
          <CardContent className="space-y-4 pt-6">
            <ol className="space-y-3 text-sm text-muted-foreground list-decimal pl-5">
              <li>
                <span className="font-medium text-foreground">Inscris-toi ou connecte-toi.</span> Les contributions sont
                réservées aux membres authentifiés.
              </li>
              <li>
                <span className="font-medium text-foreground">Ouvre ton profil &gt; Confidentialité.</span> Active la case
                « Je veux contribuer à la Blobosphère » pour signaler ton intention.
              </li>
              <li>
                <span className="font-medium text-foreground">Retourne sur ton tableau de bord.</span> Le bouton « Proposer
                un sujet » apparaît alors et ta proposition est transmise à l’équipe éditoriale pour relecture.
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              💡 Tant que l’option n’est pas activée dans ton profil, les formulaires de contribution restent cachés.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/register">Créer un compte</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/profile">Accéder à mon profil</Link>
              </Button>
            </div>
            <div className="flex">
              <Button asChild variant="ghost">
                <Link href="/">← Retour à l’accueil</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
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
