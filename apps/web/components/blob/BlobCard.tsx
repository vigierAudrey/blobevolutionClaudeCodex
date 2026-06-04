import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

/*
 * BlobCard — card avec mode DA Blob.
 * Chaque mode applique palette + bordure cohérente.
 * L'image (slot optionnel) doit passer par BlobMediaFrame.
 */
export type BlobCardMode = 'dark' | 'sand' | 'yellowSignal';

const modeBase: Record<BlobCardMode, string> = {
  dark:        'bg-blob-black   text-white         border-white/10',
  sand:        'bg-blob-sand    text-blob-black     border-blob-sand-deep',
  yellowSignal:'bg-blob-yellow  text-blob-black     border-blob-yellow-dark/40',
};

const modeHover: Record<BlobCardMode, string> = {
  dark:        'hover:border-blob-yellow/60  hover:shadow-[0_4px_24px_rgba(0,0,0,0.5)]',
  sand:        'hover:border-blob-yellow/60  hover:shadow-[0_4px_24px_rgba(0,0,0,0.12)]',
  yellowSignal:'hover:border-blob-black/30   hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)]',
};

interface BlobCardProps extends HTMLAttributes<HTMLDivElement> {
  mode?: BlobCardMode;
  /** Slot pour l'image en haut de la card (utiliser BlobMediaFrame) */
  media?: React.ReactNode;
}

export function BlobCard({
  mode = 'sand',
  media,
  className,
  children,
  ...props
}: BlobCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-sm border-2',
        'transition-all duration-300 motion-safe:hover:-translate-y-1',
        modeBase[mode],
        modeHover[mode],
        className,
      )}
      {...props}
    >
      {media && <div className="w-full shrink-0">{media}</div>}
      <div className="flex flex-col flex-1 p-5">{children}</div>
    </div>
  );
}
