import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BlobMark } from './BlobMark';

export type BlobBadgeProps = {
  variant?: 'yellow' | 'dark' | 'sand' | 'outline' | 'success' | 'error';
  size?: 'sm' | 'md';
  brandMark?: boolean;
  children: ReactNode;
};

const variantClass: Record<NonNullable<BlobBadgeProps['variant']>, string> = {
  yellow: 'border-blob-yellow bg-blob-yellow text-blob-black',
  dark: 'border-blob-black bg-blob-black text-white',
  sand:    'border-blob-sand-deep dark:border-white/20 bg-blob-sand dark:bg-white/10 text-blob-black dark:text-white',
  outline: 'border-current bg-transparent text-current',
  success: 'border-green-800 dark:border-green-500 bg-green-50 dark:bg-green-950/40 text-green-950 dark:text-green-100',
  error:   'border-red-800 dark:border-red-500 bg-red-50 dark:bg-red-950/40 text-red-950 dark:text-red-100',
};

const sizeClass: Record<NonNullable<BlobBadgeProps['size']>, string> = {
  sm: 'px-2 py-1 text-[10px]',
  md: 'px-3 py-1.5 text-xs',
};

export function BlobBadge({
  variant = 'yellow',
  size = 'sm',
  brandMark = false,
  children,
}: BlobBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border-2 font-black uppercase tracking-[0.12em]',
        variantClass[variant],
        sizeClass[size],
      )}
    >
      {brandMark && <BlobMark size={size === 'sm' ? 14 : 16} decorative />}
      {children}
    </span>
  );
}
