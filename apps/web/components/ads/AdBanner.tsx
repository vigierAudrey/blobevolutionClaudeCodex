'use client';

import { useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useConsent } from '../../hooks/useConsent';
import { loadAdSense } from '../../lib/ads/loadAdSense';
import type { ConsentMode } from '../../lib/apiClient';

interface AdBannerProps {
  slot: string;
  format?: 'auto' | 'rectangle' | 'vertical' | 'horizontal';
  responsive?: boolean;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
    gtag?: (...args: unknown[]) => void;
  }
}

const HOUSE_MESSAGES: Record<'loading' | 'config' | 'refused', { title: string; description: string }> = {
  loading: {
    title: 'Préférences en cours',
    description: 'Les annonces s’afficheront après la prise en compte de ton choix.',
  },
  config: {
    title: 'Blob House Ads',
    description: 'Découvre la Blobosphère, les bons plans spots et nos partenaires éthiques.',
  },
  refused: {
    title: 'Blob House Ads',
    description: 'Découvre la Blobosphère, les bons plans spots et nos partenaires éthiques.',
  },
};

const HouseAd = ({
  className = '',
  variant,
}: {
  className?: string;
  variant: keyof typeof HOUSE_MESSAGES;
}) => {
  const content = HOUSE_MESSAGES[variant];
  return (
    <div
      className={`rounded-md border border-slate-300/70 bg-slate-100/60 px-6 py-5 text-center text-xs text-slate-600 shadow-sm backdrop-blur-sm ${className}`}
    >
      <div className="text-sm font-semibold text-slate-700 tracking-wide uppercase">{content.title}</div>
      <div className="mt-2 leading-relaxed text-slate-600">{content.description}</div>
      <div className="mt-3 inline-flex items-center gap-2 text-[10px] text-slate-500">
        <span className="rounded-full bg-slate-200 px-2 py-0.5 uppercase tracking-wide">
          Blob&nbsp;•&nbsp;{new Date().getFullYear()}
        </span>
      </div>
    </div>
  );
};

const getNpaValue = (mode: ConsentMode) => (mode === 'personalized' ? '0' : '1');

export function AdBanner({
  slot,
  format = 'auto',
  responsive = true,
  className = '',
}: AdBannerProps) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const enabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';
  const pathname = usePathname();
  const { consentMode, consentSignals, consentReady } = useConsent();

  const adEnabled = useMemo(
    () => enabled && Boolean(clientId) && consentReady && consentMode !== 'none',
    [clientId, consentMode, consentReady, enabled],
  );

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('[AdBanner]', { slot, consentMode, consentSignals, adEnabled });
    }
  }, [adEnabled, consentMode, consentSignals, slot]);

  useEffect(() => {
    if (!adEnabled) return;

    if (typeof window.gtag === 'function') {
      window.gtag('event', 'ad_impression', {
        ad_mode: consentMode,
        ad_slot: slot,
        page_location: pathname ?? '',
      });
    }

    loadAdSense()
      .then(() => {
        try {
          window.adsbygoogle = window.adsbygoogle || [];
          window.adsbygoogle.push({});
        } catch (error) {
          console.warn('AdSense rendering error', error);
        }
      })
      .catch((error) => {
        console.warn('Unable to load AdSense script', error);
      });
  }, [adEnabled, consentMode, pathname, slot]);

  if (!enabled || !clientId) {
    return <HouseAd className={className} variant="config" />;
  }

  if (!consentReady) {
    return <HouseAd className={className} variant="loading" />;
  }

  if (consentMode === 'none') {
    return <HouseAd className={className} variant="refused" />;
  }

  return (
    <div className={`ad-banner ${className}`}>
      <ins
        key={`${slot}-${consentMode}`}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
        data-npa={getNpaValue(consentMode)}
        data-adtest={process.env.NODE_ENV !== 'production' ? 'on' : undefined}
        data-adsbygoogle-status={consentSignals.ad_storage}
      />
    </div>
  );
}

export function AdBannerFeed(props: Omit<AdBannerProps, 'format'>) {
  return (
    <AdBanner
      {...props}
      format="rectangle"
      className={`my-6 text-center ${props.className || ''}`}
    />
  );
}

export function AdBannerSidebar(props: Omit<AdBannerProps, 'format'>) {
  return (
    <AdBanner
      {...props}
      format="vertical"
      className={`hidden lg:block ${props.className || ''}`}
    />
  );
}

export function AdBannerArticle(props: Omit<AdBannerProps, 'format'>) {
  return (
    <AdBanner
      {...props}
      format="auto"
      className={`my-8 mx-auto ${props.className || ''}`}
    />
  );
}
