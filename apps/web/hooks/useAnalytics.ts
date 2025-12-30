import { useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useConsent } from './useConsent';

export type AnalyticsEventInput =
  | { eventType: 'BLOBOSPHERE_VIEW'; contentId: string }
  | { eventType: 'BLOBOSPHERE_OUTBOUND'; contentId: string; domain: string; campaignId?: string }
  | { eventType: 'BLOBOSPHERE_SIGNUP'; contentId?: string }
  | { eventType: 'PRO_DASHBOARD_OPEN' };

const isAnalyticsAllowed = (mode: string) => mode === 'personalized' || mode === 'npa';

export function useAnalytics() {
  const { consentMode, consentReady, userHash } = useConsent();

  const trackEvent = useCallback(
    (event: AnalyticsEventInput) => {
      if (!consentReady || !isAnalyticsAllowed(consentMode)) return;
      if (!userHash) return;
      void apiClient.trackAnalyticsEvent({ ...event, consentHash: userHash }).catch(() => {});
    },
    [consentMode, consentReady, userHash],
  );

  return {
    trackEvent,
    canTrack: consentReady && isAnalyticsAllowed(consentMode),
  };
}
