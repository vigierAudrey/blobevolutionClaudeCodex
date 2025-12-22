import React from 'react';

/**
 * Mock de next/image pour Storybook
 * Rend une balise <img> standard avec les props passées
 */

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  layout?: string;
  objectFit?: string;
  objectPosition?: string;
  loading?: 'lazy' | 'eager';
  priority?: boolean;
  quality?: number;
  placeholder?: 'blur' | 'empty';
  blurDataURL?: string;
}

export default function Image({
  src,
  alt,
  width,
  height,
  layout,
  objectFit,
  objectPosition,
  loading,
  priority,
  quality,
  placeholder,
  blurDataURL,
  ...rest
}: ImageProps) {
  // Convertir les props Next.js en props HTML standard
  const style = {
    ...rest.style,
    ...(objectFit && { objectFit }),
    ...(objectPosition && { objectPosition }),
  };

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading || (priority ? 'eager' : 'lazy')}
      style={style}
      {...rest}
    />
  );
}
