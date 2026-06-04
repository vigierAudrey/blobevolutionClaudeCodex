import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

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
  media?: ReactNode;
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
        /* group pour cibler les enfants au hover */
        'group flex flex-col overflow-hidden rounded-sm border-2',
        'transition-all duration-400 motion-safe:hover:-translate-y-[6px]',
        modeBase[mode],
        modeHover[mode],
        className,
      )}
      {...props}
    >
      {media && (
        <div className="relative w-full shrink-0 overflow-hidden">
          {/* Image scale organique au hover — vague qui gonfle */}
          <div className="motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out motion-safe:group-hover:scale-[1.04]">
            {media}
          </div>
          {/* Renforcement contraste photo au hover */}
          <div
            className="absolute inset-0 bg-blob-black opacity-0 motion-safe:transition-opacity motion-safe:duration-400 motion-safe:group-hover:opacity-[0.18] pointer-events-none"
            aria-hidden
          />
        </div>
      )}
      <div className="flex flex-col flex-1 p-5">{children}</div>
    </div>
  );
}
