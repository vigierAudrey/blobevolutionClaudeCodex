import type React from 'react';

type SafeMdxContentProps = {
  content: string;
  articleSlug: string;
};

type Block =
  | { type: 'heading'; depth: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; language: string | null; text: string };

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function sanitizeHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (href.startsWith('/') || href.startsWith('#')) {
    return href;
  }
  if (isExternalHref(href)) {
    try {
      const parsed = new URL(href);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

function findNextInlineToken(text: string) {
  const patterns = [
    { type: 'link' as const, match: /\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(text) },
    { type: 'strong' as const, match: /\*\*([^*\n]+)\*\*/.exec(text) },
    { type: 'em' as const, match: /(?<!\*)\*([^*\n]+)\*(?!\*)/.exec(text) },
    { type: 'code' as const, match: /`([^`\n]+)`/.exec(text) },
  ].filter((candidate): candidate is { type: 'link' | 'strong' | 'em' | 'code'; match: RegExpExecArray } => candidate.match !== null);

  return patterns.sort((a, b) => a.match.index - b.match.index)[0] ?? null;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const token = findNextInlineToken(remaining);
    if (!token) {
      nodes.push(remaining);
      break;
    }

    if (token.match.index > 0) {
      nodes.push(remaining.slice(0, token.match.index));
    }

    const [raw] = token.match;
    if (token.type === 'link') {
      const label = token.match[1];
      const href = sanitizeHref(token.match[2]);
      if (href) {
        const external = isExternalHref(href);
        nodes.push(
          <a
            key={`inline-${key++}`}
            href={href}
            className="font-bold text-blob-black underline decoration-blob-yellow decoration-2 underline-offset-4 hover:text-blob-yellow-dark dark:text-white dark:hover:text-blob-yellow"
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer' : undefined}
          >
            {label}
          </a>,
        );
      } else {
        nodes.push(label);
      }
    } else if (token.type === 'strong') {
      nodes.push(<strong key={`inline-${key++}`}>{token.match[1]}</strong>);
    } else if (token.type === 'em') {
      nodes.push(<em key={`inline-${key++}`}>{token.match[1]}</em>);
    } else {
      nodes.push(
        <code key={`inline-${key++}`} className="rounded-sm border border-blob-sand-deep bg-blob-sand px-1 py-0.5 text-[0.9em] dark:border-white/10 dark:bg-white/10">
          {token.match[1]}
        </code>,
      );
    }

    remaining = remaining.slice(token.match.index + raw.length);
  }

  return nodes;
}

function isBlockStart(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    /^```/.test(trimmed) ||
    /^#{1,3}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed)
  );
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || null;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language, text: codeLines.join('\n') });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({ type: 'heading', depth: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join(' ') });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

export function SafeMdxContent({ content, articleSlug }: SafeMdxContentProps) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-5 text-base leading-7 text-blob-black/82 dark:text-white/82" data-article={articleSlug}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const className = block.depth === 1 ? 'text-3xl' : block.depth === 2 ? 'text-2xl' : 'text-xl';
          const HeadingTag = `h${block.depth}` as 'h1' | 'h2' | 'h3';
          return (
            <HeadingTag key={index} className={`${className} pt-3 font-black uppercase leading-tight text-blob-black dark:text-white`}>
              {renderInline(block.text)}
            </HeadingTag>
          );
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote key={index} className="border-l-4 border-blob-yellow bg-blob-sand px-4 py-3 text-blob-black/78 dark:bg-white/8 dark:text-white/78">
              {renderInline(block.text)}
            </blockquote>
          );
        }
        if (block.type === 'ul' || block.type === 'ol') {
          const ListTag = block.type;
          return (
            <ListTag key={index} className={block.type === 'ul' ? 'list-disc space-y-2 pl-6' : 'list-decimal space-y-2 pl-6'}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === 'code') {
          return (
            <pre key={index} className="overflow-x-auto rounded-sm border-2 border-blob-black bg-blob-black p-4 text-sm text-white">
              <code data-language={block.language ?? undefined}>{block.text}</code>
            </pre>
          );
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

export const __safeMdxTestUtils = {
  parseBlocks,
  sanitizeHref,
};
