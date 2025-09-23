'use client';

import { useEffect, useState } from 'react';

interface AdBannerProps {
  slot: string;
  format?: 'auto' | 'rectangle' | 'vertical' | 'horizontal';
  responsive?: boolean;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle: any[];
    gtag?: (...args: any[]) => void;
  }
}

export function AdBanner({
  slot,
  format = 'auto',
  responsive = true,
  className = ''
}: AdBannerProps) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;
  const enabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';
  const [consentLevel, setConsentLevel] = useState<string | null>(null);

  useEffect(() => {
    // Récupérer le niveau de consentement
    const savedConsent = localStorage.getItem('cookie-consent');
    setConsentLevel(savedConsent);
  }, []);

  useEffect(() => {
    if (!enabled || !clientId || !consentLevel) return;

    try {
      // Configurer Google Analytics selon le consentement
      if (window.gtag) {
        window.gtag('consent', 'update', {
          ad_storage: consentLevel === 'personalized' ? 'granted' : 'denied',
          ad_user_data: consentLevel === 'personalized' ? 'granted' : 'denied',
          ad_personalization: consentLevel === 'personalized' ? 'granted' : 'denied',
          analytics_storage: consentLevel === 'personalized' ? 'granted' : 'denied'
        });
      }

      // Push l'annonce vers AdSense
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (error) {
      console.error('Erreur AdSense:', error);
    }
  }, [enabled, clientId, consentLevel]);

  // Si AdSense désactivé, pas configuré, ou pas de consentement
  if (!enabled || !clientId) {
    return null;
  }

  // Si pas encore de consentement, ne pas afficher
  if (!consentLevel) {
    return null;
  }

  // Si consentement essential seulement, afficher pub contextuelle simple
  if (consentLevel === 'essential') {
    return (
      <div className={`ad-banner-basic border-2 border-dashed border-blue-200 bg-blue-50 p-4 text-center ${className}`}>
        <div className="text-sm text-blue-700">
          <div className="font-medium">🏄 Espace partenaire surf/kite</div>
          <div className="text-xs mt-1">Publicité non personnalisée</div>
        </div>
      </div>
    );
  }

  // Consentement personnalisé : AdSense complet
  return (
    <div className={`ad-banner ${className}`}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
        data-npa={consentLevel === 'personalized' ? '0' : '1'} // Non-personalized ads si pas de consentement complet
      />
    </div>
  );
}

// Composants pré-configurés pour différents emplacements
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