"use client";

import Link from 'next/link';
import { useAnalytics } from '@/hooks/useAnalytics';

export const BLOBOSPHERE_SIGNUP_INTENT_KEY = 'blobosphere_signup_intent';
export const BLOBOSPHERE_SIGNUP_ARTICLE_KEY = 'blobosphere_signup_article';

type LinkProps = {
  href: string;
  className?: string;
  children: React.ReactNode;
};

export function BlobosphereArticleLink({ href, className, children, contentId }: LinkProps & { contentId: string }) {
  const { trackEvent } = useAnalytics();

  const handleClick = () => {
    trackEvent({ eventType: 'BLOBOSPHERE_VIEW', contentId });
  };

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}

export function BlobosphereSignupLink({ href, className, children }: LinkProps) {
  const handleClick = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BLOBOSPHERE_SIGNUP_INTENT_KEY, new Date().toISOString());
      const hash = window.location.hash.replace('#', '').trim();
      if (hash.match(/^[a-z0-9-]{1,80}$/i)) {
        window.localStorage.setItem(BLOBOSPHERE_SIGNUP_ARTICLE_KEY, hash);
      }
    }
  };

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}
