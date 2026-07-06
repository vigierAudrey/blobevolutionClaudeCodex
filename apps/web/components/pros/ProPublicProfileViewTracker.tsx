"use client";

import { useEffect, useRef } from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';

/**
 * Fires PUBLIC_PRO_PROFILE_VIEW once per mount for a /pros/[slug] page.
 * Renders nothing — mounted as a child of the Server Component page so the
 * page itself stays server-rendered. useAnalytics() is consent-gated
 * (personalized/npa only) and silently no-ops without consent — no PII,
 * no IP, just a pseudonymous consentHash already established elsewhere.
 */
export function ProPublicProfileViewTracker({ slug }: { slug: string }) {
  const { trackEvent } = useAnalytics();
  const trackedRef = useRef(false);

  useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;
    trackEvent({ eventType: 'PUBLIC_PRO_PROFILE_VIEW', contentId: slug });
  }, [trackEvent, slug]);

  return null;
}
