import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BlobMark } from './BlobMark';

export type BlobEmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  mode?: 'sand' | 'dark';
};

const modeClass: Record<NonNullable<BlobEmptyStateProps['mode']>, string> = {
  sand: 'border-blob-sand-deep bg-white text-blob-black',
  dark: 'border-white/15 bg-blob-black text-white',
};

export function BlobEmptyState({
  title,
  description,
  action,
  mode = 'sand',
}: BlobEmptyStateProps) {
  const isDark = mode === 'dark';

  return (
    <section
      className={cn(
        'flex flex-col items-center rounded-sm border-2 px-5 py-8 text-center',
        modeClass[mode],
      )}
    >
      <div
        className={cn(
          'mb-4 flex h-14 w-14 items-center justify-center rounded-sm border-2',
          isDark ? 'border-white/15 bg-white/5' : 'border-blob-black/15 bg-blob-sand',
        )}
        aria-hidden="true"
      >
        <BlobMark size={36} decorative />
      </div>
      <h2 className="text-xl font-black uppercase tracking-widest">{title}</h2>
      {description && (
        <p className={cn('mt-2 max-w-md text-sm leading-6', isDark ? 'text-white/72' : 'text-blob-black/72')}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}
