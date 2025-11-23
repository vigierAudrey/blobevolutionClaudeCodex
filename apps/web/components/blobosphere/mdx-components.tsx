"use client";
import * as React from 'react';
import type { MDXComponents } from '@mdx-js/react';
import { MDXProvider } from '@mdx-js/react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function Callout(props: { type?: 'info' | 'warning' | 'success' | 'error'; title?: string; children?: React.ReactNode }) {
  const color = props.type || 'info';
  const colorClasses =
    color === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : color === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : color === 'error'
          ? 'border-red-300 bg-red-50 text-red-900'
          : 'border-sky-300 bg-sky-50 text-sky-900';
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
      ? 'border-red-300 bg-red-50 text-red-900'
      : v === 'success'
        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
        : v === 'warning'
          ? 'border-amber-300 bg-amber-50 text-amber-900'
          : 'border-slate-200 bg-slate-50 text-slate-900';
  return <div className={`my-3 rounded-md border px-4 py-3 text-sm ${klass}`}>{props.children}</div>;
}

export function CodeBlock(props: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
  // Accept <pre><code class="language-xxx">...</code></pre> or direct children string
  const child = Array.isArray(props.children) ? props.children[0] : props.children;
  const code = React.isValidElement(child) ? (child.props?.children ?? '') : child ?? '';
  const langClass = React.isValidElement(child) ? String(child.props?.className || '') : '';
  const lang = (langClass.match(/language-([a-z0-9]+)/i)?.[1] || '').toLowerCase();
  return (
    <pre className="my-3 overflow-x-auto rounded-md border bg-slate-50 p-3 text-xs">
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
    <div className="mb-6 overflow-hidden rounded-2xl border bg-white">
      {props.image && (
        <BlobImage src={props.image} alt={props.title} className="max-h-72 w-full overflow-hidden" />
      )}
      <div className="space-y-3 p-5">
        <h1 className="text-2xl font-semibold text-gray-900">{props.title}</h1>
        {props.excerpt && <p className="text-sm text-slate-700">{props.excerpt}</p>}
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
  return <div className="prose max-w-none text-slate-800 [&>p]:my-3 [&>h2]:mt-6 [&>h3]:mt-4">{children}</div>;
}

// Helpers to extract text for JSON-LD
function toText(node: React.ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => toText(n)).join(' ');
  if (React.isValidElement(node)) return toText((node.props as any)?.children);
  return '';
}

type QAProps = { question: string; children?: React.ReactNode };
export function QA({ question, children }: QAProps) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="font-medium text-gray-900">{question}</p>
      <div className="mt-1 text-sm text-slate-700">{children}</div>
    </div>
  );
}

export function FAQ({ children, title }: { children?: React.ReactNode; title?: string }) {
  const items = React.Children.toArray(children).flatMap((child) => {
    if (React.isValidElement(child) && (child.type === QA || (child.props && 'question' in child.props))) {
      const q = (child.props as any).question as string;
      const a = toText((child.props as any).children);
      return [{ question: q, answer: a }];
    }
    return [] as Array<{ question: string; answer: string }>;
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
    <div className="space-y-3 rounded-2xl border bg-white p-4">
      {title && <h2 className="text-xl font-semibold">{title}</h2>}
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
    </div>
  );
}

export function Checklist({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      {title && <h3 className="mb-2 text-lg font-semibold">{title}</h3>}
      <ul className="space-y-2">
        {React.Children.map(children, (child, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-flex h-4 w-4 items-center justify-center rounded border border-emerald-400 bg-emerald-50 text-[10px] text-emerald-700">
              ✓
            </span>
            <div className="text-sm text-slate-800">{child}</div>
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
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : t === 'seo'
        ? 'border-sky-300 bg-sky-50 text-sky-900'
        : 'border-emerald-300 bg-emerald-50 text-emerald-900';
  return (
    <div className={`my-3 rounded-md border px-4 py-3 text-sm ${klass}`}>
      {icon && <span className="mr-2" aria-hidden>{icon}</span>}
      {children}
    </div>
  );
}

export function Material({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      {title && <h3 className="mb-3 text-lg font-semibold">{title}</h3>}
      <div className="grid gap-3 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

export function Gear({ name, link }: { name: string; link?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <p className="text-sm font-medium text-slate-900">{name}</p>
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
    h1: (props) => <h1 {...props} className={`mt-6 text-2xl font-semibold ${props.className || ''}`.trim()} />,
    h2: (props) => <h2 {...props} className={`mt-5 text-xl font-semibold ${props.className || ''}`.trim()} />,
    h3: (props) => <h3 {...props} className={`mt-4 text-lg font-semibold ${props.className || ''}`.trim()} />,
    p: (props) => <p {...props} className={`my-3 text-sm leading-relaxed text-slate-800 ${props.className || ''}`.trim()} />,
    ul: (props) => <ul {...props} className={`my-3 list-disc pl-5 ${props.className || ''}`.trim()} />,
    ol: (props) => <ol {...props} className={`my-3 list-decimal pl-5 ${props.className || ''}`.trim()} />,
    li: (props) => <li {...props} className={`${props.className || ''}`.trim()} />,
    a: (props) => <a {...props} className={`text-sky-700 underline ${props.className || ''}`.trim()} target="_blank" rel="noreferrer" />,
    img: (props) => <img {...props} className={`my-2 max-w-full rounded-md border ${props.className || ''}`.trim()} />,
    pre: (props) => <CodeBlock {...props} />,
  };
  return components;
}

// Optionally export a provider wrapper if needed elsewhere
export function MdxGlobalProvider({ children }: { children: React.ReactNode }) {
  return <MDXProvider components={getMdxComponents()}>{children}</MDXProvider>;
}
