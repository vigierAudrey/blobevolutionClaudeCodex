'use client';

import Image, { type ImageProps } from 'next/image';
import { useEffect, useState } from 'react';
import { resolveProfilePhotoSrc } from '@/lib/media';

type ProfilePhotoProps = Omit<ImageProps, 'src'> & {
  src?: string | null;
  fallbackClassName?: string;
};

export function ProfilePhoto({
  src,
  alt,
  className,
  fallbackClassName,
  onError,
  ...props
}: ProfilePhotoProps) {
  const resolvedSrc = resolveProfilePhotoSrc(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={fallbackClassName ?? className}
      >
        <span className="text-xs font-medium text-current/60">Photo indisponible</span>
      </div>
    );
  }

  return (
    <Image
      {...props}
      src={resolvedSrc}
      alt={alt}
      className={className}
      unoptimized
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
