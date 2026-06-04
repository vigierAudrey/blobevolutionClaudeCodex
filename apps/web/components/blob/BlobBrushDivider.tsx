import { cn } from '@/lib/utils';

/*
 * BlobBrushDivider — transition organique entre sections.
 * Le SVG remplit la couleur du prochain bloc (celui d'en-dessous).
 * Placer à la fin de la section précédente (ou au début de la suivante).
 *
 * Exemple :
 *   <BlobSection mode="dark">
 *     ...contenu...
 *     <BlobBrushDivider fill="sand" />   ← la section sand arrive après
 *   </BlobSection>
 */

type DividerFill = 'dark' | 'sand' | 'yellow' | 'background';

const fillClass: Record<DividerFill, string> = {
  dark:       'fill-blob-black',
  sand:       'fill-blob-sand',
  yellow:     'fill-blob-yellow',
  background: 'fill-background',
};

interface BlobBrushDividerProps {
  /** Couleur du prochain bloc (section en-dessous) */
  fill?: DividerFill;
  /** Retourne verticalement — utile pour diviser depuis le bas */
  flip?: boolean;
  className?: string;
  'aria-hidden'?: boolean;
}

export function BlobBrushDivider({
  fill = 'sand',
  flip = false,
  className,
  'aria-hidden': ariaHidden = true,
}: BlobBrushDividerProps) {
  return (
    <div
      className={cn('w-full overflow-hidden leading-none', className)}
      aria-hidden={ariaHidden}
      style={flip ? { transform: 'scaleY(-1)' } : undefined}
    >
      {/* Path organique simulant un coup de pinceau horizontal */}
      <svg
        viewBox="0 0 1440 40"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn('block w-full h-8 sm:h-10', fillClass[fill])}
        focusable="false"
      >
        <path d="M0,22 C80,4 160,36 280,20 C400,4 460,34 580,18 C700,2 760,30 900,16 C1040,2 1120,32 1240,20 C1360,8 1410,28 1440,22 L1440,40 L0,40 Z" />
      </svg>
    </div>
  );
}
