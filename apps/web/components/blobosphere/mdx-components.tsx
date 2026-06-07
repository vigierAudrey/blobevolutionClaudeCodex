"use client";
import * as React from 'react';
import type { MDXComponents } from 'mdx/types';
import { MDXProvider } from '@mdx-js/react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAnalytics } from '@/hooks/useAnalytics';

const mergeClasses = (base: string, extra?: string) => [base, extra].filter(Boolean).join(' ');

const isExternalHref = (href: string) => /^https?:\/\//i.test(href);

const extractDomain = (href: string) => {
  try {
    const url = new URL(href);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
};

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  'data-campaign'?: string;
  'data-article'?: string;
};

function MdxLink({ className, ...props }: LinkProps) {
  const { trackEvent } = useAnalytics();
  const href = typeof props.href === 'string' ? props.href : '';
  const isExternal = href && isExternalHref(href);

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (!isExternal) return;
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/blobosphere')) {
      return;
    }

    const domain = extractDomain(href);
    if (!domain) return;

    let contentId = typeof props['data-article'] === 'string' ? props['data-article'] : '';
    if (!contentId && typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '').trim();
      if (hash.match(/^[a-z0-9-]{1,80}$/i)) {
        contentId = hash;
      }
    }

    if (!contentId) return;

    const campaignId = typeof props['data-campaign'] === 'string' ? props['data-campaign'] : undefined;
    trackEvent({ eventType: 'BLOBOSPHERE_OUTBOUND', contentId, domain, campaignId });
  };

  return (
    <a
      {...props}
      className={mergeClasses('text-sky-700 dark:text-sky-400 underline', className)}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
    />
  );
}

export function Callout(props: { type?: 'info' | 'warning' | 'success' | 'error'; title?: string; children?: React.ReactNode }) {
  const color = props.type || 'info';
  const colorClasses =
    color === 'success'
      ? 'border-emerald-300 dark:border-emerald-600/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-300'
      : color === 'warning'
        ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300'
        : color === 'error'
          ? 'border-red-300 dark:border-red-600/50 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-300'
          : 'border-sky-300 dark:border-sky-600/50 bg-sky-50 dark:bg-sky-950/30 text-sky-900 dark:text-sky-300';
  return (
    <div className={`my-4 rounded-md border ${colorClasses} px-4 py-3`}> 
      {props.title && <p className="mb-1 font-semibold">{props.title}</p>}
      <div className="text-sm leading-relaxed">{props.children}</div>
    </div>
  );
}

export function Alert(props: { variant?: 'default' | 'destructive' | 'success' | 'warning'; children?: React.ReactNode }) {
  const v = props.variant || 'default';
  const klass =
    v === 'destructive'
      ? 'border-red-300 dark:border-red-600/50 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-300'
      : v === 'success'
        ? 'border-emerald-300 dark:border-emerald-600/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-300'
        : v === 'warning'
          ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300'
          : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[hsl(220_14%_14%)] text-slate-900 dark:text-white/85';
  return <div className={`my-3 rounded-md border px-4 py-3 text-sm ${klass}`}>{props.children}</div>;
}

export function CodeBlock({ children, className, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const child = Array.isArray(children) ? children[0] : children;
  let code: React.ReactNode = child ?? '';
  let langClass = '';

  if (React.isValidElement(child)) {
    const element = child as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
    code = element.props.children ?? '';
    langClass = String(element.props.className ?? '');
  }

  const lang = (langClass.match(/language-([a-z0-9]+)/i)?.[1] || '').toLowerCase();
  return (
    <pre {...rest} className={mergeClasses('my-3 overflow-x-auto rounded-md border bg-slate-50 dark:bg-[hsl(220_14%_10%)] dark:border-white/10 dark:text-white/85 p-3 text-xs', className)}>
      <code className={lang ? `language-${lang}` : undefined}>{code}</code>
    </pre>
  );
}

export function BlobImage(props: { src: string; alt?: string; width?: number; height?: number; className?: string }) {
  const { src, alt = '', width = 1200, height = 630, className } = props;
  // Next/Image requires explicit width/height for static optimization; we default sensibly for preview.
  return (
    <div className={className || 'my-3'}>
      <Image src={src} alt={alt} width={width} height={height} className="h-auto w-full rounded-md border" />
    </div>
  );
}

// -----------------------------
// Structured editorial components
// -----------------------------

type HeaderProps = {
  title: string;
  excerpt?: string;
  image?: string;
  tags?: string[];
};

export function Header(props: HeaderProps) {
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border dark:border-white/10 bg-white dark:bg-[hsl(220_14%_14%)]">
      {props.image && (
        <BlobImage src={props.image} alt={props.title} className="max-h-72 w-full overflow-hidden" />
      )}
      <div className="space-y-3 p-5">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{props.title}</h1>
        {props.excerpt && <p className="text-sm text-slate-700 dark:text-white/65">{props.excerpt}</p>}
        {Array.isArray(props.tags) && props.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {props.tags.map((t) => (
              <Badge key={t} variant="outline">{t}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Body({ children }: { children?: React.ReactNode }) {
  // prose class (if typography plugin active) + sensible defaults
  return <div className="prose max-w-none text-slate-800 dark:text-white/85 [&>p]:my-3 [&>h2]:mt-6 [&>h3]:mt-4">{children}</div>;
}

// Helpers to extract text for JSON-LD
function toText(node: React.ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => toText(n)).join(' ');
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return toText(props.children);
  }
  return '';
}

type QAProps = { question: string; children?: React.ReactNode };
export function QA({ question, children }: QAProps) {
  return (
    <div className="rounded-lg border dark:border-white/10 bg-white dark:bg-[hsl(220_14%_14%)] p-3">
      <p className="font-medium text-gray-900 dark:text-white">{question}</p>
      <div className="mt-1 text-sm text-slate-700 dark:text-white/65">{children}</div>
    </div>
  );
}

export function FAQ({ children, title }: { children?: React.ReactNode; title?: string }) {
  const items = React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    const props = child.props as { question?: string; children?: React.ReactNode };
    if (child.type === QA || props.question) {
      return [{ question: props.question ?? '', answer: toText(props.children) }];
    }
    return [];
  });

  const jsonLd = items.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map((it) => ({
          '@type': 'Question',
          name: it.question,
          acceptedAnswer: { '@type': 'Answer', text: it.answer },
        })),
      }
    : null;

  return (
    <div className="space-y-3 rounded-2xl border dark:border-white/10 bg-white dark:bg-[hsl(220_14%_14%)] p-4">
      {title && <h2 className="text-xl font-semibold dark:text-white">{title}</h2>}
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
    </div>
  );
}

export function Checklist({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border dark:border-white/10 bg-white dark:bg-[hsl(220_14%_14%)] p-4">
      {title && <h3 className="mb-2 text-lg font-semibold dark:text-white">{title}</h3>}
      <ul className="space-y-2">
        {React.Children.map(children, (child, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-flex h-4 w-4 items-center justify-center rounded border border-emerald-400 dark:border-emerald-600/60 bg-emerald-50 dark:bg-emerald-950/40 text-[10px] text-emerald-700 dark:text-emerald-400">
              ✓
            </span>
            <div className="text-sm text-slate-800 dark:text-white/80">{child}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Item({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function Tips({ children, type, icon }: { children?: React.ReactNode; type?: 'securite' | 'astuce' | 'seo' | string; icon?: string }) {
  const t = type || 'astuce';
  const klass =
    t === 'securite'
      ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300'
      : t === 'seo'
        ? 'border-sky-300 dark:border-sky-600/50 bg-sky-50 dark:bg-sky-950/30 text-sky-900 dark:text-sky-300'
        : 'border-emerald-300 dark:border-emerald-600/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-300';
  return (
    <div className={`my-3 rounded-md border px-4 py-3 text-sm ${klass}`}>
      {icon && <span className="mr-2" aria-hidden>{icon}</span>}
      {children}
    </div>
  );
}

export function Material({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border dark:border-white/10 bg-white dark:bg-[hsl(220_14%_14%)] p-4">
      {title && <h3 className="mb-3 text-lg font-semibold dark:text-white">{title}</h3>}
      <div className="grid gap-3 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

export function Gear({ name, link }: { name: string; link?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border dark:border-white/10 p-3">
      <p className="text-sm font-medium text-slate-900 dark:text-white">{name}</p>
      {link ? (
        <Button asChild size="sm" variant="outline">
          <a href={link} target="_blank" rel="noreferrer">Voir</a>
        </Button>
      ) : null}
    </div>
  );
}

export function getMdxComponents(): MDXComponents {
  const components: MDXComponents = {
    // Custom shortcodes
    Callout,
    Alert,
    CodeBlock,
    BlobImage,
    Header,
    Body,
    FAQ,
    QA,
    Checklist,
    Item,
    Tips,
    Material,
    Gear,
    // HTML element overrides for consistent styling
    h1: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 {...props} className={mergeClasses('mt-6 text-2xl font-semibold', className)} />
    ),
    h2: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 {...props} className={mergeClasses('mt-5 text-xl font-semibold', className)} />
    ),
    h3: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 {...props} className={mergeClasses('mt-4 text-lg font-semibold', className)} />
    ),
    p: ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props} className={mergeClasses('my-3 text-sm leading-relaxed text-slate-800 dark:text-white/80', className)} />
    ),
    ul: ({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul {...props} className={mergeClasses('my-3 list-disc pl-5', className)} />
    ),
    ol: ({ className, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol {...props} className={mergeClasses('my-3 list-decimal pl-5', className)} />
    ),
    li: ({ className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) => (
      <li {...props} className={mergeClasses('', className)} />
    ),
    a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <MdxLink {...props} />,
    img: ({ alt, className, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      // `img` fallback is only used in preview mode, Next/Image handles production rendering.
      // eslint-disable-next-line @next/next/no-img-element
      <img {...props} alt={alt ?? ''} className={mergeClasses('my-2 max-w-full rounded-md border', className)} />
    ),
    pre: (props: React.HTMLAttributes<HTMLPreElement>) => <CodeBlock {...props} />,
  };
  return components;
}

// Optionally export a provider wrapper if needed elsewhere
export function MdxGlobalProvider({ children }: { children: React.ReactNode }) {
  return <MDXProvider components={getMdxComponents()}>{children}</MDXProvider>;
}
