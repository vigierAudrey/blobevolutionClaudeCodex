"use client";

import type { MouseEvent } from 'react';

type SkipLinkProps = {
  targetId?: string;
};

export function SkipLink({ targetId = 'main-content' }: SkipLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (!target) return;

    event.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });

    const hash = `#${targetId}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
  };

  return (
    <a href={`#${targetId}`} className="skip-link" data-testid="skip-link" onClick={handleClick}>
      Aller au contenu principal
    </a>
  );
}
