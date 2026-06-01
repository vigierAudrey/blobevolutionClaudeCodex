import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SafeMdxContent } from '@/components/blobosphere/SafeMdxContent';
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
    <article className="mx-auto max-w-3xl space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      <nav aria-label="Fil d’Ariane" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-sky-700 dark:hover:text-sky-300">
              Blob
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/blobosphere" className="font-medium text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100">
              Blobosphère
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground">{topic?.label ?? article.category}</li>
        </ol>
      </nav>

      <header className="space-y-5 border-b pb-8">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{topic?.label ?? article.category}</Badge>
          <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          <span aria-hidden="true">·</span>
          <span>{article.readingTime}</span>
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
            {article.title}
          </h1>
          <p className="text-lg leading-8 text-muted-foreground">{article.excerpt}</p>
        </div>

        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </header>

      <SafeMdxContent content={article.body} articleSlug={article.slug} />

      <section className="rounded-lg border bg-sky-50 px-5 py-5 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-50">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Envie de rejoindre la communauté Blob ?</h2>
            <p className="text-sm text-sky-900/80 dark:text-sky-100/80">
              Crée un profil pour échanger avec des riders et trouver des partenaires sans publier de spot sensible.
            </p>
          </div>
          <Button asChild className="bg-sky-700 text-white hover:bg-sky-800">
            <Link href={`/register?intent=blobosphere&article=${encodeURIComponent(article.slug)}`}>Créer un compte</Link>
          </Button>
        </div>
      </section>

      <Link href="/blobosphere" className="inline-flex text-sm font-medium text-sky-700 underline underline-offset-2 dark:text-sky-300">
        Retour à la Blobosphère
      </Link>
    </article>
  );
}
