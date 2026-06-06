import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type BlobLogoProps = {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  asLink?: boolean;
  className?: string;
};

const logoByVariant = {
  light: {
    src: '/images/brand/blob-wordmark-yellow-white-details-transparent-shadow.png',
    width: 575,
    height: 268,
  },
  dark: {
    src: '/images/brand/blob-logo-transparent-details.png',
    width: 662,
    height: 300,
  },
} as const;

const sizeClass: Record<NonNullable<BlobLogoProps['size']>, string> = {
  sm: 'w-[96px]',
  md: 'w-[132px]',
  lg: 'w-[176px]',
};

const sizesBySize: Record<NonNullable<BlobLogoProps['size']>, string> = {
  sm: '96px',
  md: '132px',
  lg: '176px',
};

export function BlobLogo({
  variant = 'light',
  size = 'md',
  asLink = false,
  className,
}: BlobLogoProps) {
  const logo = logoByVariant[variant];
  const image = (
    <Image
      src={logo.src}
      alt="Blob"
      width={logo.width}
      height={logo.height}
      className={cn('h-auto shrink-0', sizeClass[size], className)}
      sizes={sizesBySize[size]}
    />
  );

  if (!asLink) {
    return image;
  }

  return (
    <Link
      href="/"
      aria-label="Blob — Retour à l'accueil"
      className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-blob-black"
    >
      {image}
    </Link>
  );
}
