"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MDXProvider } from '@mdx-js/react';
import { getMdxComponents } from './mdx-components';
import * as runtime from 'react/jsx-runtime';

type Frontmatter = {
  title?: string;
  tags?: string[];
  [key: string]: unknown;
};

interface MdxRuntimePreviewProps {
  markdown: string;
  frontmatter?: Frontmatter;
  className?: string;
}

export function MdxRuntimePreview({ markdown, frontmatter, className }: MdxRuntimePreviewProps) {
  const [Comp, setComp] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const cancelRef = useRef<boolean>(false);

  const components = useMemo(() => getMdxComponents(), []);
  const hasContent = (markdown || '').trim().length > 0;

  useEffect(() => {
    cancelRef.current = false;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    // Debounce compilation for smoother typing
    debounceRef.current = window.setTimeout(async () => {
      if (!hasContent) {
        setComp(null);
        setError(null);
        return;
      }
      setCompiling(true);
      setError(null);
      try {
        // Lazy import to keep bundle smaller
        const { evaluate } = await import('@mdx-js/mdx');
        const rehypePrism = (await import('rehype-prism-plus')).default as any;
        const mod: any = await evaluate(markdown, {
          ...runtime,
          // We wrap with MDXProvider, no need for providerImportSource
          development: process.env.NODE_ENV !== 'production',
          useDynamicImport: false,
          rehypePlugins: [rehypePrism],
        });
        if (cancelRef.current) return;
        const MDXContent: React.ComponentType = mod.default || (() => null);
        setComp(() => MDXContent);
      } catch (e: any) {
        if (cancelRef.current) return;
        setComp(null);
        setError(e?.message || 'Erreur de compilation MDX');
      } finally {
        if (!cancelRef.current) setCompiling(false);
      }
    }, 150);

    return () => {
      cancelRef.current = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [markdown, hasContent]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Aperçu</CardTitle>
        <CardDescription>Rendu MDX live (mêmes composants qu’en public)</CardDescription>
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
            {compiling && (
              <div className="mb-2 text-xs text-slate-500">Compilation…</div>
            )}
            {Comp ? (
              <MDXProvider components={components}>
                <Comp />
              </MDXProvider>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MdxRuntimePreview;
