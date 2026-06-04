import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

/*
 * BlobMediaFrame — wrapper image/vidéo avec overlay Dark Ocean.
 * Utiliser autour de <Image> ou <video> pour appliquer le filtre de marque.
 *
 * overlayDirection:
 *   'bottom' → dégradé du bas (cards, visuels portrait)
 *   'full'   → dégradé cinématique haut/bas (hero, bandeau)
 */
interface BlobMediaFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  overlay?: boolean;
  overlayDirection?: 'bottom' | 'full';
}

export function BlobMediaFrame({
  children,
  overlay = true,
  overlayDirection = 'bottom',
  className,
  ...props
}: BlobMediaFrameProps) {
  return (
    <div className={cn('relative overflow-hidden', className)} {...props}>
      {children}
      {overlay && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none',
            overlayDirection === 'full'
              ? 'bg-gradient-to-b from-blob-black/80 via-blob-black/30 to-blob-black/90'
              : 'bg-gradient-to-t from-blob-black/65 via-blob-black/15 to-transparent',
          )}
          aria-hidden
        />
      )}
    </div>
  );
}
