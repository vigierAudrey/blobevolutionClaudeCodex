import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

/*
 * BlobSection — wrapper de section avec mode DA Blob.
 * Modes : dark (Dark Ocean) | sand (Sand Paper) | yellow (Yellow Signal)
 *
 * Proportions cibles : ~50% sand, ~30% dark, ~15% yellow.
 */
export type BlobSectionMode = 'dark' | 'sand' | 'yellow';

const modeBase: Record<BlobSectionMode, string> = {
  dark:   'bg-blob-black text-white',
  sand:   'bg-blob-sand text-blob-black',
  yellow: 'bg-blob-yellow text-blob-black',
};

interface BlobSectionProps extends HTMLAttributes<HTMLElement> {
  mode?: BlobSectionMode;
  /** Élément HTML rendu — section par défaut */
  as?: 'section' | 'div' | 'article' | 'aside' | 'footer' | 'header';
  /** Active un conteneur max-w centré à l'intérieur */
  container?: boolean;
  containerClassName?: string;
  py?: 'sm' | 'md' | 'lg';
}

const pyClass: Record<NonNullable<BlobSectionProps['py']>, string> = {
  sm: 'py-8',
  md: 'py-14',
  lg: 'py-20',
};

export function BlobSection({
  mode = 'sand',
  as: Tag = 'section',
  container = true,
  py = 'md',
  className,
  containerClassName,
  children,
  ...props
}: BlobSectionProps) {
  return (
    <Tag className={cn('w-full', modeBase[mode], className)} {...props}>
      {container ? (
        <div
          className={cn(
            'mx-auto max-w-5xl px-4 sm:px-6 lg:px-8',
            pyClass[py],
            containerClassName,
          )}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </Tag>
  );
}
