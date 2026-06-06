import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BlobMark } from './BlobMark';

export type BlobBrandBadgeProps = {
  children: ReactNode;
  tone?: 'yellow' | 'dark' | 'sand';
  className?: string;
};

const toneClass: Record<NonNullable<BlobBrandBadgeProps['tone']>, string> = {
  yellow: 'border-blob-yellow bg-blob-yellow text-blob-black',
  dark: 'border-blob-black bg-blob-black text-white',
  sand: 'border-blob-sand-deep bg-blob-sand text-blob-black',
};

export function BlobBrandBadge({
  children,
  tone = 'yellow',
  className,
}: BlobBrandBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-sm border-2 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em]',
        toneClass[tone],
        className,
      )}
    >
      <BlobMark size={18} decorative />
      {children}
    </span>
  );
}
