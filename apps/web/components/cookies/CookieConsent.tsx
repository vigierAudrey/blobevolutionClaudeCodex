'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Settings, Cookie, Target, Shield } from 'lucide-react';
import { useConsent } from '../../hooks/useConsent';
import type { ConsentMode } from '../../lib/apiClient';

type ConsentLevel = 'none' | 'essential' | 'personalized';

interface CookieConsentProps {
  onConsentChange?: (level: ConsentLevel) => void;
}

export const COOKIE_CONSENT_REOPEN_EVENT = 'blobinfini:cookie-consent:reopen';

const mapModeToLegacy = (mode: ConsentMode): ConsentLevel => {
  if (mode === 'personalized') return 'personalized';
  if (mode === 'npa') return 'essential';
  return 'none';
};

export function CookieConsent({ onConsentChange }: CookieConsentProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const { consentMode, consentReady, updateConsent } = useConsent();
  const adsenseEnabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';

  useEffect(() => {
    if (!adsenseEnabled) {
      if (consentReady) {
        setIsVisible(consentMode === 'none');
      }
      return;
    }

    if (!consentReady) {
      if (consentMode === 'none') {
        const timer = setTimeout(() => setIsVisible(true), 1200);
        return () => clearTimeout(timer);
      }
      return;
    }

    setIsVisible(consentMode === 'none');
  }, [adsenseEnabled, consentMode, consentReady]);

  const handleSelection = useCallback(
    async (mode: ConsentMode) => {
      await updateConsent(mode);
      setIsVisible(false);
      onConsentChange?.(mapModeToLegacy(mode));
    },
    [onConsentChange, updateConsent],
  );

  const reopenBanner = () => {
    setShowDetails(false);
    setIsVisible(true);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleExternalReopen = () => {
      setShowDetails(false);
      setIsVisible(true);
    };

    window.addEventListener(COOKIE_CONSENT_REOPEN_EVENT, handleExternalReopen);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_REOPEN_EVENT, handleExternalReopen);
    };
  }, []);

  if (!isVisible) {
    return adsenseEnabled && consentReady ? (
      <button
        onClick={reopenBanner}
        className="fixed bottom-4 right-4 z-40 p-2 bg-gray-100 hover:bg-gray-200 rounded-full shadow-md transition-colors"
        title="Gérer les cookies"
      >
        <Cookie className="h-4 w-4" />
      </button>
    ) : null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Vos préférences de confidentialité
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pour assurer le bon fonctionnement de Blob et comprendre comment la plateforme est utilisée, nous utilisons des cookies. Vous choisissez ce que vous acceptez.
          </p>

          {/* Options de consentement */}
          <div className="space-y-3">
            <div className="p-3 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Fonctionnel &amp; mesure anonyme</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Session, sécurité et statistiques d&apos;usage sans identification personnelle
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSelection('npa')}
                className="w-full"
              >
                Continuer avec le fonctionnel
              </Button>
            </div>

            <div className="p-3 border rounded-lg bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">Expérience optimisée</span>
                  <Badge className="bg-blue-500">Recommandé</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                ✨ Navigation adaptée à vos habitudes sur Blob
                <br />💡 Aide à améliorer la plateforme pour tous
              </p>
              <Button
                onClick={() => handleSelection('personalized')}
                className="w-full"
                size="sm"
              >
                Accepter l&apos;expérience optimisée
              </Button>
            </div>

            <div className="p-3 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-500" />
                  <span className="font-medium">Essentiel uniquement</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Uniquement les cookies indispensables, sans aucune statistique d&apos;usage.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSelection('npa')}
                className="w-full"
              >
                Continuer sans statistiques
              </Button>
            </div>
          </div>

          {/* Détails techniques */}
          <div className="pt-2 border-t">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-3 w-3" />
              {showDetails ? 'Masquer' : 'Voir'} les détails techniques
            </button>

            {showDetails && (
              <div className="mt-3 p-3 bg-gray-50 rounded text-xs space-y-2">
                <div>
                  <strong>Cookies essentiels :</strong> Fonctionnement de l&apos;app, sécurité, préférences
                </div>
                <div>
                  <strong>Cookies de mesure :</strong> Statistiques d&apos;usage anonymes pour améliorer la plateforme
                </div>
                <div>
                  <strong>Données utilisées :</strong> Pages visitées, fonctionnalités utilisées, préférences de navigation
                </div>
                <div>
                  <strong>Conservation :</strong> Données agrégées, non identifiantes, conformes RGPD
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Vous pouvez modifier vos préférences à tout moment.
            <button
              onClick={() => handleSelection('none')}
              className="underline hover:no-underline ml-1"
            >
              Tout refuser
            </button>
            <button
              onClick={() => setShowDetails((prev) => !prev)}
              className="ml-3 underline hover:no-underline"
            >
              {showDetails ? 'Fermer les détails' : 'En savoir plus'}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Hook pour utiliser le niveau de consentement
export function useCookieConsent() {
  const { consentMode, updateConsent: setConsentMode, consentReady } = useConsent();

  const updateConsent = useCallback(
    (level: ConsentLevel) => {
      const mode: ConsentMode = level === 'personalized' ? 'personalized' : level === 'essential' ? 'npa' : 'none';
      setConsentMode(mode);
    },
    [setConsentMode],
  );

  const consentLevel = mapModeToLegacy(consentMode);

  return {
    consentLevel,
    updateConsent,
    hasPersonalizedConsent: consentMode === 'personalized',
    hasEssentialConsent: consentMode === 'personalized' || consentMode === 'npa',
    consentReady,
  };
}
