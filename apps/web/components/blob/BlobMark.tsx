import Image from 'next/image';
import { cn } from '@/lib/utils';

export type BlobMarkProps = {
  size?: number;
  decorative?: boolean;
  className?: string;
};

export function BlobMark({ size = 32, decorative = true, className }: BlobMarkProps) {
  return (
    <Image
      src="/images/brand/blob-b-mark-transparent.png"
      alt={decorative ? '' : 'Symbole Blob'}
      width={size}
      height={size}
      className={cn('h-auto w-auto shrink-0', className)}
      aria-hidden={decorative ? true : undefined}
      sizes={`${size}px`}
    />
  );
}
