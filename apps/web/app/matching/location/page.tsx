"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { apiClient } from '../../../lib/apiClient';
import { Button } from '../../../components/ui/button';

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
          'Cliquez sur l\'icône 🔒 ou ⓘ à gauche de l\'adresse URL',
          'Trouvez "Position" ou "Localisation"',
          'Changez de "Bloquer" à "Autoriser"',
          'Rechargez la page avec F5'
        ]
      };
    case 'edge':
      return {
        title: 'Edge',
        steps: [
          'Cliquez sur l\'icône 🔒 à gauche de l\'adresse URL',
          'Trouvez "Autorisations pour ce site"',
          'Changez "Emplacement" à "Autoriser"',
          'Rechargez la page avec F5'
        ]
      };
    case 'firefox':
      return {
        title: 'Firefox',
        steps: [
          'Cliquez sur l\'icône 🔒 à gauche de l\'adresse URL',
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
          'Recherchez l\'icône de sécurité près de l\'adresse URL',
          'Trouvez les paramètres de localisation/position',
          'Autorisez l\'accès à votre position',
          'Rechargez la page'
        ]
      };
  }
};

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';
type Partner = 'ALL' | 'WOMEN' | 'MEN';

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
  const [user, setUser] = useState<any>(null);
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

        const currentUser = await apiClient.me();
        setUser(currentUser);

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
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/matching" />
      <Card>
        <CardHeader>
          <CardTitle>3) Localisation & Distance</CardTitle>
          <CardDescription>Active ta localisation (optionnel) et choisis une distance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={getLocation}>Activer ma position</Button>
              <div className="text-xs text-muted-foreground">
                {lat != null && lng != null ? `Position: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Position non activée'}
              </div>
            </div>
            {geolocError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Impossible d'accéder à votre position</span>
                </h4>
                <p className="text-sm text-red-800 mb-3">
                  Votre navigateur bloque l'accès à votre position. Pour débloquer, suivez ces étapes pour {getBrowserInstructions(browserType).title} :
                </p>
                <ol className="text-sm text-red-800 space-y-1 ml-4">
                  {getBrowserInstructions(browserType).steps.map((step, idx) => (
                    <li key={idx} className="list-decimal">
                      {step}
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-red-700 mt-3 italic">
                  💡 La géolocalisation est optionnelle pour le matching mais permet d'améliorer les résultats.
                </p>
                <Button
                  onClick={getLocation}
                  variant="outline"
                  className="mt-3"
                  size="sm"
                >
                  🔄 Réessayer après avoir autorisé
                </Button>
              </div>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={saveDefault} onChange={(e)=>setSaveDefault(e.target.checked)} />
            <span>Enregistrer cette position comme position par défaut de mon profil</span>
          </label>
          <div className="space-y-2">
            <label htmlFor="distance">Distance maximale (km)</label>
            <div className="flex items-center gap-3">
              <input id="distance" type="range" min={5} max={200} step={5} value={distanceKm} onChange={(e)=>setDistanceKm(Number(e.target.value))} className="w-full"/>
              <Input type="number" min={1} max={500} value={distanceKm} onChange={(e)=>setDistanceKm(Number(e.target.value))} className="w-20"/>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={()=>{ setLat(null); setLng(null); localStorage.removeItem(LAT_KEY); localStorage.removeItem(LNG_KEY); }}>Effacer position</Button>
            <Button onClick={saveAndNext}>Continuer</Button>
          </div>
          <div className="text-sm text-muted-foreground">Sélection actuelle: {breadcrumb}</div>
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
