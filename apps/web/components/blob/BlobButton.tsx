'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/*
 * BlobButton — hiérarchie validée DA Blob (2026-06-04)
 *
 * Règle non négociable :
 *   jaune   = action prioritaire
 *   noir/outline = action secondaire
 *
 * Style : uppercase, tracking-widest, boxy (pas SaaS arrondi).
 */
const blobButtonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'font-bold uppercase tracking-widest',
    'border-2 rounded-sm',
    'transition-all duration-200',
    'focus-visible:outline-none focus-visible:ring-2',
    'focus-visible:ring-blob-yellow focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    /* Hover : léger lift + scale (effet affiche / tampon) */
    'motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-[1.02]',
    /* Active : snap back + compression (press sticker) */
    'motion-safe:active:translate-y-0 motion-safe:active:scale-[0.97]',
  ].join(' '),
  {
    variants: {
      variant: {
        /* Jaune Blob — CTA prioritaire : hero rider, "Rejoindre" navbar */
        primaryYellow:
          'bg-blob-yellow text-blob-black border-blob-yellow ' +
          'hover:bg-blob-yellow-dark hover:border-blob-yellow-dark ' +
          'hover:shadow-[0_4px_20px_rgba(251,191,36,0.40)]',

        /* Noir — CTA secondaire sur fond clair */
        dark:
          'bg-blob-black text-white border-blob-black ' +
          'hover:bg-zinc-800 hover:border-zinc-800 ' +
          'hover:shadow-[0_4px_16px_rgba(0,0,0,0.50)]',

        /* Outline blanc — secondaire sur fond sombre */
        outlineLight:
          'bg-transparent text-white border-white ' +
          'hover:bg-white/10 ' +
          'hover:shadow-[0_4px_16px_rgba(255,255,255,0.12)]',

        /* Outline noir — secondaire sur fond sable */
        outlineDark:
          'bg-transparent text-blob-black border-blob-black ' +
          'hover:bg-blob-black hover:text-white ' +
          'hover:shadow-[0_4px_16px_rgba(0,0,0,0.20)]',

        /* Mode Yellow Signal — bouton noir sur fond jaune */
        yellowSignalDark:
          'bg-blob-black text-white border-blob-black ' +
          'hover:bg-zinc-800 hover:border-zinc-800 ' +
          'hover:shadow-[0_4px_16px_rgba(0,0,0,0.50)]',
      },
      size: {
        sm: 'px-4 py-2 text-xs',
        md: 'px-5 py-3 text-sm',
        lg: 'px-7 py-4 text-sm',
        xl: 'px-9 py-5 text-base',
      },
    },
    defaultVariants: {
      variant: 'primaryYellow',
      size: 'lg',
    },
  },
);

export type BlobButtonVariant = NonNullable<VariantProps<typeof blobButtonVariants>['variant']>;
export type BlobButtonSize    = NonNullable<VariantProps<typeof blobButtonVariants>['size']>;

interface BlobButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof blobButtonVariants> {
  asChild?: boolean;
}

const BlobButton = forwardRef<HTMLButtonElement, BlobButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(blobButtonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
BlobButton.displayName = 'BlobButton';

export { BlobButton, blobButtonVariants };
