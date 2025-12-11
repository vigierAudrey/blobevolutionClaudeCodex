"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { apiClient } from '../../../lib/apiClient';
import type { DashboardUser } from '@/types/user';
import type { Level, Sport } from '@/types/matching';
import { CalendarDays, Sparkles, Navigation, MapPin, AlertTriangle, GraduationCap } from 'lucide-react';

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
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/matching" />

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-8 text-white shadow-xl">
        <div className="absolute inset-0 opacity-45 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_transparent_55%)]" aria-hidden />
        <div className="relative z-10 flex flex-col gap-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            Étape 3 · Date & options
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Bloque ta prochaine session</h1>
          <p className="text-white/85 text-base">
            Choisis une date rapide ou laisse le matching en mode &ldquo;Peu importe&rdquo;. Option cours pro & géoloc juste en dessous.
          </p>
        </div>
      </section>

      <Card className="border-2">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-purple-100 text-purple-700">
              Étape 3
            </Badge>
            <CardTitle className="text-xl flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-muted-foreground" />
              Choix de date
            </CardTitle>
          </div>
          <CardDescription>Précise ton créneau pour filtrer les riders disponibles.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { key: formatDateISO(today), label: `Aujourd'hui (${formatDateDisplay(today)})` },
              { key: formatDateISO(tomorrow), label: `Demain (${formatDateDisplay(tomorrow)})` },
              { key: 'anytime', label: '🗓️ Peu importe' },
            ].map((d) => (
              <button
                key={d.key}
                onClick={() => setDatePersist(d.key)}
                aria-pressed={dateISO === d.key}
                className={`rounded-2xl border-2 px-4 py-5 text-left text-sm font-medium transition-all shadow-sm hover:shadow-md ${
                  dateISO === d.key
                    ? 'border-fuchsia-500 bg-fuchsia-50/80 ring-2 ring-fuchsia-200'
                    : 'border-border hover:border-fuchsia-200'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
            {dateISO
              ? dateISO === 'anytime'
                ? 'Mode flexible : nous te proposons les meilleurs matchs sans contrainte de date.'
                : `Date sélectionnée : ${dateISO}`
              : 'Sélectionne un créneau pour débloquer la suite.'}
          </div>
        </CardContent>
      </Card>

      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Badge variant="secondary" className="bg-amber-100 text-amber-700">
              Option
            </Badge>
            <span className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-muted-foreground" />
              Cours avec un pro
            </span>
          </CardTitle>
          <CardDescription>
            Active le badge pour signaler aux autres riders et aux pros que tu cherches un cours.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm font-medium">
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
              className="h-5 w-5"
            />
            <span>Je veux un cours avec un professionnel sur cette session</span>
          </label>

          {wantsLesson && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-800 space-y-2">
              <p>
                Activer ce badge informe les riders et pros que tu cherches un cours. Coordinate-toi avec ton binôme pour éviter
                les doublons.
              </p>
              <p>
                Pour publier une demande visible sur la BloboMap, remplis{' '}
                <Link href="/lesson-request" className="font-semibold underline">
                  le formulaire dédié
                </Link>
                . Un seul formulaire par groupe suffit.
              </p>
              <p className="italic text-blue-700/90">Aucun cours n’est réservé automatiquement pour le moment.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Badge variant="secondary" className="bg-sky-100 text-sky-700">
              Étape 4
            </Badge>
            <span className="flex items-center gap-2">
              <Navigation className="w-5 h-5 text-muted-foreground" />
              Géolocalisation (optionnel)
            </span>
          </CardTitle>
          <CardDescription>Affiche plus de riders proches grâce au rayon personnalisé.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={useGeoloc}
              onChange={(e) => toggleUseGeoloc(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>Utiliser ma position pour calculer la distance</span>
          </label>

          {useGeoloc && (
            <>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={getLocation} className="inline-flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Activer ma position
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {lat != null && lng != null ? `Position : ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Position non activée'}
                  </span>
                </div>
                {geolocError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 space-y-2 text-sm text-red-800">
                    <p className="font-semibold flex items-center gap-2 text-red-900">
                      <AlertTriangle className="w-4 h-4" />
                      Autorise la localisation sur {getBrowserInstructions(browserType).title}
                    </p>
                    <ol className="list-decimal pl-4 space-y-1">
                      {getBrowserInstructions(browserType).steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                    <p className="text-xs text-red-700">Optionnel mais recommandé pour affiner la distance.</p>
                    <Button onClick={getLocation} variant="outline" size="sm">
                      Réessayer
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <label htmlFor="distance">Distance maximale</label>
                  <span className="font-semibold text-foreground">{distanceKm ?? 20} km</span>
                </div>
                <input
                  id="distance"
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={distanceKm ?? 20}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDistanceKm(v);
                    try { localStorage.setItem(DIST_KEY, String(v)); } catch {}
                    if (useGeoloc) {
                      const url = new URL(window.location.href);
                      url.searchParams.set('distanceKm', String(v));
                      window.history.replaceState(null, '', url.toString());
                    }
                  }}
                  className="w-full accent-sky-600"
                />
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const v = 20;
                      setDistanceKm(v);
                      try { localStorage.setItem(DIST_KEY, String(v)); } catch {}
                      if (useGeoloc) {
                        const url = new URL(window.location.href);
                        url.searchParams.set('distanceKm', String(v));
                        window.history.replaceState(null, '', url.toString());
                      }
                    }}
                  >
                    Reset 20 km
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Plus le rayon est large, plus tu as de chance de matcher rapidement.
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => router.push('/matching')}>
          Retour à la sélection
        </Button>
        <Button
          className="flex-1 sm:flex-none"
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
