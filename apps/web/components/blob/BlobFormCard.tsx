import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type BlobFormCardProps = {
  mode?: 'sand' | 'dark';
  children: ReactNode;
  className?: string;
};

const modeClass: Record<NonNullable<BlobFormCardProps['mode']>, string> = {
  sand: 'border-blob-sand-deep bg-blob-sand text-blob-black shadow-[0_10px_30px_rgba(22,24,28,0.10)]',
  dark: 'border-white/15 bg-blob-black text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)]',
};

export function BlobFormCard({ mode = 'sand', children, className }: BlobFormCardProps) {
  return (
    <div
      className={cn(
        'rounded-sm border-2 p-5 sm:p-6',
        'before:pointer-events-none before:block before:h-1 before:w-16 before:bg-blob-yellow before:content-[""]',
        'space-y-5',
        modeClass[mode],
        className,
      )}
    >
      {children}
    </div>
  );
}
