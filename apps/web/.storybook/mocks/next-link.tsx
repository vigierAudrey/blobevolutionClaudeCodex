import React from 'react';

/**
 * Mock de next/link pour Storybook
 * Rend une balise <a> standard avec les props passées
 */

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  as?: string;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  prefetch?: boolean;
  locale?: string | false;
  legacyBehavior?: boolean;
  children: React.ReactNode;
}

export default function Link({
  href,
  as,
  replace,
  scroll,
  shallow,
  passHref,
  prefetch,
  locale,
  legacyBehavior,
  children,
  ...rest
}: LinkProps) {
  // Dans Storybook, on utilise simplement href
  const finalHref = as || href;

  return (
    <a href={finalHref} {...rest}>
      {children}
    </a>
  );
}
