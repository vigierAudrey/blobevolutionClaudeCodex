"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { apiClient } from '../../../lib/apiClient';
import { Button } from '../../../components/ui/button';
import type { DashboardUser } from '@/types/user';
import type { Level, Partner, Sport } from '@/types/matching';
import { Badge } from '../../../components/ui/badge';
import { MapPin, AlertTriangle } from 'lucide-react';

// Force SSR due to useSearchParams and localStorage usage
export const dynamic = 'force-dynamic';

// Fonction pour détecter le navigateur de l'utilisateur
const detectBrowser = (): 'chrome' | 'firefox' | 'safari' | 'edge' | 'other' => {
  if (typeof window === 'undefined') return 'other';

  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes('edg/')) return 'edge';
  if (userAgent.includes('chrome') && !userAgent.includes('edg/')) return 'chrome';
  if (userAgent.includes('firefox')) return 'firefox';
  if (userAgent.includes('safari') && !userAgent.includes('chrome')) return 'safari';

  return 'other';
};

// Instructions selon le navigateur
const getBrowserInstructions = (browser: string): { title: string; steps: string[] } => {
  switch (browser) {
    case 'chrome':
      return {
        title: 'Chrome',
        steps: [
          'Cliquez sur l’icône 🔒 ou ⓘ à gauche de l’adresse URL',
          'Trouvez "Position" ou "Localisation"',
          'Changez de "Bloquer" à "Autoriser"',
          'Rechargez la page avec F5'
        ]
      };
    case 'edge':
      return {
        title: 'Edge',
        steps: [
          'Cliquez sur l’icône 🔒 à gauche de l’adresse URL',
          'Trouvez "Autorisations pour ce site"',
          'Changez "Emplacement" à "Autoriser"',
          'Rechargez la page avec F5'
        ]
      };
    case 'firefox':
      return {
        title: 'Firefox',
        steps: [
          'Cliquez sur l’icône 🔒 à gauche de l’adresse URL',
          'Cliquez sur "Permissions" puis "Position"',
          'Décochez "Bloquer" ou sélectionnez "Autoriser"',
          'Rechargez la page avec F5'
        ]
      };
    case 'safari':
      return {
        title: 'Safari',
        steps: [
          'Ouvrez Safari > Réglages > Sites web',
          'Dans la section "Localisation", trouvez ce site',
          'Changez à "Autoriser"',
          'Rechargez la page'
        ]
      };
    default:
      return {
        title: 'Votre navigateur',
        steps: [
          'Recherchez l’icône de sécurité près de l’adresse URL',
          'Trouvez les paramètres de localisation/position',
          'Autorisez l\'accès à votre position',
          'Rechargez la page'
        ]
      };
  }
};

const SPORT_KEY = 'matching.sport';
const LEVEL_KEY = 'matching.level';
const PARTNER_KEY = 'matching.partner';
const DIST_KEY = 'matching.distanceKm';
const LAT_KEY = 'matching.lat';
const LNG_KEY = 'matching.lng';

function LocationInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [sport, setSport] = useState<Sport | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [distanceKm, setDistanceKm] = useState<number>(20);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [saveDefault, setSaveDefault] = useState<boolean>(false);
  const [browserType, setBrowserType] = useState<string>('other');
  const [geolocError, setGeolocError] = useState<boolean>(false);

  // Vérifier le rôle utilisateur
  useEffect(() => {
    (async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = await apiClient.me() as DashboardUser;

        if (currentUser.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);

  useEffect(() => {
    // Détecter le navigateur au montage du composant
    setBrowserType(detectBrowser());

    const qsSport = (sp.get('sport') as Sport | null) || (localStorage.getItem(SPORT_KEY) as Sport | null);
    const qsLevel = (sp.get('level') as Level | null) || (localStorage.getItem(LEVEL_KEY) as Level | null);
    const qsPartner = (sp.get('partner') as Partner | null) || (localStorage.getItem(PARTNER_KEY) as Partner | null);
    const lsDist = Number(localStorage.getItem(DIST_KEY) || '20') || 20;
    const lsLat = localStorage.getItem(LAT_KEY);
    const lsLng = localStorage.getItem(LNG_KEY);
    setSport(qsSport || null);
    setLevel(qsLevel || null);
    setPartner(qsPartner || 'ALL');
    setDistanceKm(lsDist);
    setLat(lsLat ? Number(lsLat) : null);
    setLng(lsLng ? Number(lsLng) : null);
  }, [sp]);

  useEffect(() => {
    if (sport && level) return;
    const t = setTimeout(() => router.replace('/matching'), 0);
    return () => clearTimeout(t);
  }, [router, sport, level]);

  const saveAndNext = async () => {
    try { localStorage.setItem(DIST_KEY, String(distanceKm)); } catch {}
    if (lat != null && lng != null) {
      try { localStorage.setItem(LAT_KEY, String(lat)); localStorage.setItem(LNG_KEY, String(lng)); } catch {}
      if (saveDefault) {
        try { await apiClient.updateProfile({ lat, lng }); } catch {}
      }
    }
    const url = new URL(window.location.origin + '/matching/date');
    if (sport) url.searchParams.set('sport', sport);
    if (level) url.searchParams.set('level', level);
    if (partner) url.searchParams.set('partner', partner);
    url.searchParams.set('distanceKm', String(distanceKm));
    if (lat != null && lng != null) { url.searchParams.set('lat', String(lat)); url.searchParams.set('lng', String(lng)); }
    window.location.href = url.toString();
  };

  const breadcrumb = useMemo(() => {
    const parts = [sport || '—', level || '—', partner || '—', `${distanceKm} km`];
    return parts.join(' > ');
  }, [sport, level, partner, distanceKm]);

  const getLocation = () => {
    if (!navigator.geolocation) {
      setGeolocError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setGeolocError(false);
      },
      (error) => {
        console.error('Erreur géolocalisation:', error);
        setGeolocError(true);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/matching" />

      {/* Header compact avec progression */}
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-cyan-100 to-teal-100 dark:from-cyan-900/20 dark:to-teal-900/20 p-4 border-2 border-cyan-200/50 dark:border-cyan-800/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 text-white shadow-md">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Zone de recherche</h1>
            <p className="text-sm text-muted-foreground">Localisation & rayon (optionnel)</p>
          </div>
        </div>
        <Badge variant="secondary" className="bg-white dark:bg-slate-800 text-cyan-600 dark:text-cyan-400">
          Optionnel
        </Badge>
      </div>

      <Card className="border-2">
        <CardHeader>
          <CardTitle className="text-xl">Localisation & distance</CardTitle>
          <CardDescription>Active ta position pour trouver des riders proches</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border bg-muted/60 px-4 py-3 text-sm text-muted-foreground flex flex-col gap-1">
            <span className="font-semibold text-foreground">Sélection courante</span>
            <span>{breadcrumb}</span>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={getLocation} className="inline-flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Activer ma position
              </Button>
              <div className="text-xs text-muted-foreground">
                {lat != null && lng != null ? `Position : ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Position non activée'}
              </div>
            </div>
            {geolocError && (
              <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 space-y-3 text-sm text-red-800">
                <p className="font-semibold flex items-center gap-2 text-red-900">
                  <AlertTriangle className="w-4 h-4" />
                  Autorise la localisation sur {getBrowserInstructions(browserType).title}
                </p>
                <ol className="list-decimal space-y-1 pl-4">
                  {getBrowserInstructions(browserType).steps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
                <p className="text-xs text-red-700">La géolocalisation est optionnelle mais améliore les résultats.</p>
                <Button onClick={getLocation} variant="outline" size="sm">
                  Réessayer
                </Button>
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={saveDefault}
              onChange={(e) => setSaveDefault(e.target.checked)}
              className="mt-1"
            />
            <span>Enregistrer cette position comme spot par défaut sur mon profil</span>
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Distance maximale</span>
              <span className="font-semibold text-foreground">{distanceKm} km</span>
            </div>
            <input
              id="distance"
              type="range"
              min={5}
              max={200}
              step={5}
              value={distanceKm}
              onChange={(e) => setDistanceKm(Number(e.target.value))}
              className="w-full accent-sky-600"
            />
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={500}
                value={distanceKm}
                onChange={(e) => setDistanceKm(Number(e.target.value))}
                className="w-28"
              />
              <p className="text-xs text-muted-foreground">
                Astuce : augmente légèrement le rayon si tu cherches un binôme rare.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setLat(null);
                setLng(null);
                localStorage.removeItem(LAT_KEY);
                localStorage.removeItem(LNG_KEY);
              }}
            >
              Effacer la position
            </Button>
            <div className="flex-1" />
            <Button onClick={saveAndNext} className="flex-1 sm:flex-none">
              Continuer vers la date
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page(){
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto">Chargement…</div>}>
      <LocationInner />
    </Suspense>
  );
}
