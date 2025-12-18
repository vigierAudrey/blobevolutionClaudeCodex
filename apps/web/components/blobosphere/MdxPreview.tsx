"use client";
import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Frontmatter = {
  title?: string;
  tags?: string[];
  excerpt?: string;
  [key: string]: unknown;
};

interface MdxPreviewProps {
  markdown: string;
  frontmatter?: Frontmatter;
  className?: string;
}

// Very small, dependency-free markdown → React renderer for preview purposes.
// Supports: headings, paragraphs, lists, images, links, code fences, inline bold/italic.
// Intentionally does NOT execute arbitrary JSX/MDX components for safety and simplicity.
function inlineParse(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  const pushText = (t: string) => {
    if (!t) return;
    parts.push(<React.Fragment key={`${keyPrefix}-t-${parts.length}`}>{t}</React.Fragment>);
  };

  // Simple transforms priority: images -> links -> bold -> italic
  // We apply sequentially by splitting.
  const transform = (input: string): React.ReactNode[] => {
    const out: React.ReactNode[] = [];

    // Images ![alt](url)
    const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(input))) {
      if (m.index > lastIndex) out.push(input.slice(lastIndex, m.index));
      const alt = m[1];
      const src = m[2];
      out.push(
        <img
          key={`${keyPrefix}-img-${out.length}`}
          src={src}
          alt={alt}
          className="my-2 max-w-full rounded-md border"
        />,
      );
      lastIndex = imgRe.lastIndex;
    }
    if (lastIndex < input.length) out.push(input.slice(lastIndex));

    // Links [text](url)
    const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
    const out2: React.ReactNode[] = [];
    for (const chunk of out) {
      if (typeof chunk !== 'string') {
        out2.push(chunk);
        continue;
      }
      let idx = 0;
      let match: RegExpExecArray | null;
      while ((match = linkRe.exec(chunk))) {
        if (match.index > idx) out2.push(chunk.slice(idx, match.index));
        out2.push(
          <a key={`${keyPrefix}-a-${out2.length}`} href={match[2]} className="text-sky-700 underline" target="_blank" rel="noreferrer">
            {match[1]}
          </a>,
        );
        idx = linkRe.lastIndex;
      }
      if (idx < chunk.length) out2.push(chunk.slice(idx));
    }

    // Bold **text**
    const boldRe = /\*\*([^*]+)\*\*/g;
    const out3: React.ReactNode[] = [];
    for (const chunk of out2) {
      if (typeof chunk !== 'string') {
        out3.push(chunk);
        continue;
      }
      let idx = 0;
      let match: RegExpExecArray | null;
      while ((match = boldRe.exec(chunk))) {
        if (match.index > idx) out3.push(chunk.slice(idx, match.index));
        out3.push(<strong key={`${keyPrefix}-b-${out3.length}`}>{match[1]}</strong>);
        idx = boldRe.lastIndex;
      }
      if (idx < chunk.length) out3.push(chunk.slice(idx));
    }

    // Italic *text*
    const italicRe = /\*([^*]+)\*/g;
    const out4: React.ReactNode[] = [];
    for (const chunk of out3) {
      if (typeof chunk !== 'string') {
        out4.push(chunk);
        continue;
      }
      let idx = 0;
      let match: RegExpExecArray | null;
      while ((match = italicRe.exec(chunk))) {
        if (match.index > idx) out4.push(chunk.slice(idx, match.index));
        out4.push(<em key={`${keyPrefix}-i-${out4.length}`}>{match[1]}</em>);
        idx = italicRe.lastIndex;
      }
      if (idx < chunk.length) out4.push(chunk.slice(idx));
    }

    return out4;
  };

  parts.push(...transform(text));
  return parts;
}

function renderMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let listMode: null | { type: 'ul' | 'ol'; items: string[] } = null;
  let inCode: null | { lang: string | null; lines: string[] } = null;

  const flushList = () => {
    if (!listMode) return;
    if (listMode.type === 'ul') {
      nodes.push(
        <ul key={`ul-${nodes.length}`} className="my-3 list-disc pl-5">
          {listMode.items.map((t, idx) => (
            <li key={`li-${idx}`}>{inlineParse(t, `uli-${nodes.length}-${idx}`)}</li>
          ))}
        </ul>,
      );
    } else {
      nodes.push(
        <ol key={`ol-${nodes.length}`} className="my-3 list-decimal pl-5">
          {listMode.items.map((t, idx) => (
            <li key={`oi-${idx}`}>{inlineParse(t, `oli-${nodes.length}-${idx}`)}</li>
          ))}
        </ol>,
      );
    }
    listMode = null;
  };

  const flushParagraph = (buf: string[]) => {
    const text = buf.join(' ').trim();
    if (!text) return;
    nodes.push(
      <p key={`p-${nodes.length}`} className="my-3 text-sm text-slate-800">
        {inlineParse(text, `p-${nodes.length}`)}
      </p>,
    );
  };

  let paragraphBuf: string[] = [];

  while (i < lines.length) {
    const raw = lines[i];

    // Code fences ```lang
    const codeFence = raw.match(/^```\s*(\w+)?\s*$/);
    if (codeFence) {
      // Close paragraph and list before entering code
      flushList();
      flushParagraph(paragraphBuf);
      paragraphBuf = [];

      inCode = { lang: codeFence[1] || null, lines: [] };
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        inCode.lines.push(lines[i]);
        i++;
      }
      // Skip closing fence
      if (i < lines.length && /^```\s*$/.test(lines[i])) i++;
      nodes.push(
        <pre key={`pre-${nodes.length}`} className="my-3 overflow-x-auto rounded-md border bg-slate-50 p-3 text-xs">
          <code className="whitespace-pre-wrap">
            {inCode.lines.join('\n')}
          </code>
        </pre>,
      );
      inCode = null;
      continue;
    }

    // Headings
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      flushParagraph(paragraphBuf);
      paragraphBuf = [];
      const level = h[1].length;
      const content = h[2];
      const Tag = (`h${Math.min(6, level)}` as unknown) as keyof JSX.IntrinsicElements;
      nodes.push(
        <Tag key={`h-${nodes.length}`} className={
          level === 1
            ? 'mt-6 text-2xl font-semibold'
            : level === 2
              ? 'mt-5 text-xl font-semibold'
              : 'mt-4 text-lg font-semibold'
        }>
          {inlineParse(content, `h${level}-${nodes.length}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // Lists
    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    const ol = raw.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      // Close paragraph if any
      flushParagraph(paragraphBuf);
      paragraphBuf = [];
      if (!listMode) {
        listMode = { type: ul ? 'ul' : 'ol', items: [] };
      }
      listMode.items.push((ul ? ul[1] : (ol as RegExpMatchArray)[1]).trim());
      i++;
      // If next line is not a list item, flush in next iteration
      if (i >= lines.length || (!/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]))) {
        flushList();
      }
      continue;
    }

    // Empty line → paragraph flush
    if (!raw.trim()) {
      flushList();
      flushParagraph(paragraphBuf);
      paragraphBuf = [];
      i++;
      continue;
    }

    // Accumulate paragraph lines
    paragraphBuf.push(raw.trim());
    i++;
  }

  // Final flush
  flushList();
  flushParagraph(paragraphBuf);

  return nodes;
}

export function MdxPreview({ markdown, frontmatter, className }: MdxPreviewProps) {
  const { error, content } = useMemo(() => {
    try {
      const nodes = renderMarkdown(markdown || '');
      return { error: null as string | null, content: nodes };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Erreur de rendu';
      return { error: message, content: [] as React.ReactNode[] };
    }
  }, [markdown]);

  const hasContent = (markdown || '').trim().length > 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Aperçu</CardTitle>
        <CardDescription>Rendu live sans enregistrement</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasContent ? (
          <div className="rounded-md border bg-slate-50 p-4 text-sm text-slate-600">
            Commence à écrire pour voir l’aperçu en temps réel 📄✨
          </div>
        ) : error ? (
          <pre className="whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800">
            {error}
          </pre>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto pr-2">
            {frontmatter?.title && (
              <h1 className="mb-2 text-2xl font-semibold">{frontmatter.title}</h1>
            )}
            {Array.isArray(frontmatter?.tags) && frontmatter!.tags!.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {frontmatter!.tags!.map((t) => (
                  <span key={t} className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-slate-700">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="text-sm leading-relaxed text-slate-800">{content}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MdxPreview;
