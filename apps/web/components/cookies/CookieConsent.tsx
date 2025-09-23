'use client';

import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Settings, Cookie, Target, Shield } from 'lucide-react';

type ConsentLevel = 'none' | 'essential' | 'personalized';

interface CookieConsentProps {
  onConsentChange?: (level: ConsentLevel) => void;
}

export function CookieConsent({ onConsentChange }: CookieConsentProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [currentConsent, setCurrentConsent] = useState<ConsentLevel>('none');

  useEffect(() => {
    // Vérifier le consentement existant
    const savedConsent = localStorage.getItem('cookie-consent') as ConsentLevel | null;
    if (savedConsent) {
      setCurrentConsent(savedConsent);
      onConsentChange?.(savedConsent);
    } else {
      // Afficher la bannière seulement si AdSense est activé
      const adsenseEnabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true';
      if (adsenseEnabled) {
        // Délai pour éviter le spam dès l'arrivée
        setTimeout(() => setIsVisible(true), 2000);
      }
    }
  }, [onConsentChange]);

  const handleConsent = (level: ConsentLevel) => {
    setCurrentConsent(level);
    localStorage.setItem('cookie-consent', level);
    setIsVisible(false);
    onConsentChange?.(level);
  };

  const resetConsent = () => {
    localStorage.removeItem('cookie-consent');
    setCurrentConsent('none');
    setIsVisible(true);
  };

  if (!isVisible) {
    // Petit indicateur discret pour changer les préférences
    return currentConsent !== 'none' ? (
      <button
        onClick={resetConsent}
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
            <Target className="h-5 w-5" />
            Publicités adaptées à tes goûts surf/kite
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pour t'aider à découvrir les meilleures marques et équipements, nous aimerions personnaliser les publicités.
          </p>

          {/* Options de consentement */}
          <div className="space-y-3">
            <div className="p-3 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Publicités basiques</span>
                  <Badge variant="secondary">Gratuit</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Pubs générales surf/kite sans tracking personnel
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleConsent('essential')}
                className="w-full"
              >
                Continuer avec les pubs basiques
              </Button>
            </div>

            <div className="p-3 border rounded-lg bg-blue-50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-blue-500" />
                  <span className="font-medium">Publicités personnalisées</span>
                  <Badge className="bg-blue-500">Recommandé</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                ✨ Équipements adaptés à ton niveau et tes spots favoris
                <br />💰 Soutient le développement de l'app (revenus publicitaires)
              </p>
              <Button
                onClick={() => handleConsent('personalized')}
                className="w-full"
                size="sm"
              >
                J'accepte les pubs personnalisées
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
                  <strong>Cookies essentiels :</strong> Fonctionnement de l'app, sécurité, préférences
                </div>
                <div>
                  <strong>Cookies publicitaires :</strong> AdSense, ciblage par intérêts, mesure performance
                </div>
                <div>
                  <strong>Données utilisées :</strong> Pages visitées, sports/niveaux, localisation approximative
                </div>
                <div>
                  <strong>Partenaires :</strong> Google AdSense (voir leur politique de confidentialité)
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Tu peux modifier tes préférences à tout moment.
            <button
              onClick={resetConsent}
              className="underline hover:no-underline ml-1"
            >
              En savoir plus
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Hook pour utiliser le niveau de consentement
export function useCookieConsent() {
  const [consentLevel, setConsentLevel] = useState<ConsentLevel>('none');

  useEffect(() => {
    const savedConsent = localStorage.getItem('cookie-consent') as ConsentLevel | null;
    if (savedConsent) {
      setConsentLevel(savedConsent);
    }
  }, []);

  const updateConsent = (level: ConsentLevel) => {
    setConsentLevel(level);
    localStorage.setItem('cookie-consent', level);
  };

  return {
    consentLevel,
    updateConsent,
    hasPersonalizedConsent: consentLevel === 'personalized',
    hasEssentialConsent: consentLevel === 'essential' || consentLevel === 'personalized'
  };
}