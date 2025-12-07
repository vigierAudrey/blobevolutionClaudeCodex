"use client";

import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

type SkipLinkProps = {
  targetId?: string;
  label?: string;
} & HTMLAttributes<HTMLAnchorElement>;

export function SkipLink({ targetId = 'main-content', label = 'Aller au contenu principal', className, ...rest }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={clsx('skip-link', className)}
      data-testid="skip-link"
      {...rest}
    >
      {label}
    </a>
  );
}
