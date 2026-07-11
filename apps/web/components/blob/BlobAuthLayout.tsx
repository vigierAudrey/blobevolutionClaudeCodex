import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { BlobLogo } from './BlobLogo';

export type BlobAuthLayoutProps = {
  mode?: 'sand' | 'dark';
  title?: string;
  subtitle?: string;
  children: ReactNode;
};

const modeClass: Record<NonNullable<BlobAuthLayoutProps['mode']>, string> = {
  sand: 'bg-blob-sand text-blob-black',
  dark: 'bg-blob-black text-white',
};

export function BlobAuthLayout({
  mode = 'sand',
  title,
  subtitle,
  children,
}: BlobAuthLayoutProps) {
  const t = useTranslations('auth.layout');
  const isDark = mode === 'dark';

  return (
    <main className={cn('min-h-screen px-4 py-8 sm:px-6', modeClass[mode])}>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center gap-6">
        <div className="flex justify-center">
          <BlobLogo variant={isDark ? 'light' : 'dark'} size="lg" asLink />
        </div>

        {(title || subtitle) && (
          <header className="space-y-3 text-center">
            {title && (
              <h1 className="text-2xl font-black uppercase tracking-widest sm:text-3xl">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className={cn('text-sm leading-6', isDark ? 'text-white/72' : 'text-blob-black/72')}>
                {subtitle}
              </p>
            )}
          </header>
        )}

        {children}

        <footer className={cn('text-center text-[11px] uppercase tracking-[0.16em]', isDark ? 'text-white/50' : 'text-blob-black/55')}>
          {t('footer')}
        </footer>
      </div>
    </main>
  );
}
