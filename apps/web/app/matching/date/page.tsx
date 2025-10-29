"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';

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

const sportLabels: Record<Sport, string> = { surf: 'Surf', kitesurf: 'Kitesurf' };
const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
};

const SPORT_KEY = 'matching.sport';
const LEVEL_KEY = 'matching.level';
const DATE_KEY = 'matching.date';
const DIST_KEY = 'matching.distanceKm';
const LAT_KEY = 'matching.lat';
const LNG_KEY = 'matching.lng';
const USE_GEO_KEY = 'matching.useGeoloc';
const LESSON_KEY = 'matching.wantsLesson';

function formatDateISO(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDateDisplay(d: Date) {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
}

function DateInner() {
  const router = useRouter();
  const search = useSearchParams();

  const [sport, setSport] = useState<Sport | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [useGeoloc, setUseGeoloc] = useState<boolean>(false);
  const [hasInitialized, setHasInitialized] = useState<boolean>(false);
  const [wantsLesson, setWantsLesson] = useState<boolean>(false);
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

  // Init from query/localStorage
  useEffect(() => {
    // Détecter le navigateur au montage du composant
    setBrowserType(detectBrowser());

    const qsSport = (search.get('sport') as Sport | null) || (localStorage.getItem(SPORT_KEY) as Sport | null);
    const qsLevel = (search.get('level') as Level | null) || (localStorage.getItem(LEVEL_KEY) as Level | null);
    const qsDate = search.get('date') || localStorage.getItem(DATE_KEY);
    const qsDist = search.get('distanceKm') || localStorage.getItem(DIST_KEY);
    const qsLat = search.get('lat') || localStorage.getItem(LAT_KEY);
    const qsLng = search.get('lng') || localStorage.getItem(LNG_KEY);
    const qsUseGeoloc = search.get('useGeoloc') || localStorage.getItem(USE_GEO_KEY);
    const qsLesson = search.get('wantsLesson') || localStorage.getItem(LESSON_KEY);
    setSport(qsSport || null);
    setLevel(qsLevel || null);
    setDateISO(qsDate || null);
    setDistanceKm(qsDist ? Number(qsDist) : null);
    setLat(qsLat ? Number(qsLat) : null);
    setLng(qsLng ? Number(qsLng) : null);
    setUseGeoloc(qsUseGeoloc === '1');
    setWantsLesson(qsLesson === '1');
    setHasInitialized(true);
  }, [search]);

  // Guard: if sport/level missing after initial load, send back to matching
  useEffect(() => {
    // Only check after we've tried to initialize from search params and localStorage
    if (!hasInitialized) return;
    if (sport && level) return;

    // Redirect back to matching if required params are missing
    router.replace('/matching');
  }, [router, sport, level, hasInitialized]);

  const today = useMemo(() => new Date(), []);
  const tomorrow = useMemo(() => new Date(Date.now() + 24 * 60 * 60 * 1000), []);

  const setDatePersist = (iso: string) => {
    setDateISO(iso);
    try { localStorage.setItem(DATE_KEY, iso); } catch {}
    const url = new URL(window.location.href);
    if (sport) url.searchParams.set('sport', sport);
    if (level) url.searchParams.set('level', level);
    if (useGeoloc) url.searchParams.set('useGeoloc', '1'); else url.searchParams.delete('useGeoloc');
    if (useGeoloc && distanceKm != null) url.searchParams.set('distanceKm', String(distanceKm)); else url.searchParams.delete('distanceKm');
    if (useGeoloc && lat != null && lng != null) { url.searchParams.set('lat', String(lat)); url.searchParams.set('lng', String(lng)); } else { url.searchParams.delete('lat'); url.searchParams.delete('lng'); }
    url.searchParams.set('date', iso);
    window.history.replaceState(null, '', url.toString());
  };

  const breadcrumb = useMemo(() => {
    const dateStr = dateISO === 'anytime' ? 'peu importe' : dateISO ? new Date(dateISO + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) : '—';
    const distShort = useGeoloc ? (distanceKm != null ? `${distanceKm} km` : '—') : 'sans géolocalisation';
    return [sport ? sportLabels[sport] : '—', level ? levelLabels[level] : '—', distShort, dateStr].join(' > ');
  }, [sport, level, distanceKm, dateISO, useGeoloc]);

  const toggleUseGeoloc = (checked: boolean) => {
    setUseGeoloc(checked);
    try { localStorage.setItem(USE_GEO_KEY, checked ? '1' : '0'); } catch {}
    const url = new URL(window.location.href);
    if (checked) {
      url.searchParams.set('useGeoloc', '1');
      if (distanceKm != null) url.searchParams.set('distanceKm', String(distanceKm));
      if (lat != null && lng != null) { url.searchParams.set('lat', String(lat)); url.searchParams.set('lng', String(lng)); }
    } else {
      url.searchParams.delete('useGeoloc');
      url.searchParams.delete('distanceKm');
      url.searchParams.delete('lat');
      url.searchParams.delete('lng');
    }
    window.history.replaceState(null, '', url.toString());
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      setGeolocError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude; const lo = pos.coords.longitude;
        setLat(la); setLng(lo);
        setGeolocError(false);
        try { localStorage.setItem(LAT_KEY, String(la)); localStorage.setItem(LNG_KEY, String(lo)); } catch {}
        const url = new URL(window.location.href);
        url.searchParams.set('lat', String(la)); url.searchParams.set('lng', String(lo));
        window.history.replaceState(null, '', url.toString());
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

      <div>
        <h1 className="text-2xl font-semibold">Choisis la date</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3) Date</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: formatDateISO(today), label: `Aujourd'hui (${formatDateDisplay(today)})` },
              { key: formatDateISO(tomorrow), label: `Demain (${formatDateDisplay(tomorrow)})` },
              { key: 'anytime', label: '🗓️ Peu importe' },
            ].map((d) => (
              <button
                key={d.key}
                onClick={() => setDatePersist(d.key)}
                aria-pressed={dateISO === d.key}
                className={
                  'rounded-md border px-4 py-4 text-sm text-left transition ' +
                  (dateISO === d.key ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')
                }
              >
                {d.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">5) Cours avec un professionnel</CardTitle>
          <CardDescription>Coche si tu souhaites prendre un cours avec un pro pour cette session</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <input
              id="wantsLesson"
              type="checkbox"
              checked={wantsLesson}
              onChange={(e) => {
                const checked = e.target.checked;
                setWantsLesson(checked);
                try {
                  localStorage.setItem(LESSON_KEY, checked ? '1' : '0');
                } catch {}
                const url = new URL(window.location.href);
                if (checked) {
                  url.searchParams.set('wantsLesson', '1');
                } else {
                  url.searchParams.delete('wantsLesson');
                }
                window.history.replaceState(null, '', url.toString());
              }}
            />
            <label htmlFor="wantsLesson" className="flex items-center gap-1 text-sm">
              <span>🎓</span>
              Je veux un cours avec un professionnel
            </label>
          </div>
          {wantsLesson && (
            <div className="mt-3 p-3 bg-blue-50 rounded-md">
              <p className="text-xs text-blue-700">
                Les professionnels à proximité verront ta demande et pourront te proposer un cours pour la date sélectionnée.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">4) Géolocalisation (optionnel)</CardTitle>
          <CardDescription>Active la case pour utiliser ta position et un rayon</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={useGeoloc} onChange={(e)=>toggleUseGeoloc(e.target.checked)} />
            <span>Utiliser ma position pour calculer la distance</span>
          </label>
          {useGeoloc && (
            <>
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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="distance">Distance maximale (km)</label>
                  <span className="text-sm font-medium text-primary">{distanceKm ?? 20} km</span>
                </div>
                <div className="flex items-center gap-3">
                  <input id="distance" type="range" min={5} max={200} step={5} value={distanceKm ?? 20} onChange={(e)=>{ const v=Number(e.target.value); setDistanceKm(v); try{ localStorage.setItem(DIST_KEY, String(v)); }catch{}; if(useGeoloc){ const url=new URL(window.location.href); url.searchParams.set('distanceKm', String(v)); window.history.replaceState(null,'',url.toString()); } }} className="w-full"/>
                  <Button variant="outline" onClick={()=>{ const v=20; setDistanceKm(v); try{ localStorage.setItem(DIST_KEY, String(v)); }catch{}; if(useGeoloc){ const url=new URL(window.location.href); url.searchParams.set('distanceKm', String(v)); window.history.replaceState(null,'',url.toString()); } }}>Reset 20km</Button>
                </div>
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <Button
              disabled={!dateISO || (useGeoloc && (lat == null || lng == null))}
              onClick={() => {
                const u = new URL(window.location.origin + '/matching/cards');
                if (sport) u.searchParams.set('sport', sport);
                if (level) u.searchParams.set('level', level);
                if (dateISO) u.searchParams.set('date', dateISO);
                if (wantsLesson) u.searchParams.set('wantsLesson', '1');
                if (useGeoloc) {
                  u.searchParams.set('useGeoloc', '1');
                  if (distanceKm != null) u.searchParams.set('distanceKm', String(distanceKm));
                  if (lat != null && lng != null) { u.searchParams.set('lat', String(lat)); u.searchParams.set('lng', String(lng)); }
                }
                router.push(u.toString());
              }}
            >
              Voir les profils
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto">Chargement…</div>}>
      <DateInner />
    </Suspense>
  );
}
