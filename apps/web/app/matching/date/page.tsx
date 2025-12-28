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
import { CalendarDays, MapPin, AlertTriangle, GraduationCap } from 'lucide-react';

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
    const qsLesson = search.get('wantsLesson') || localStorage.getItem(LESSON_KEY);
    setSport(qsSport || null);
    setLevel(qsLevel || null);
    setDateISO(qsDate || null);
    setDistanceKm(qsDist ? Number(qsDist) : null);
    setLat(qsLat ? Number(qsLat) : null);
    setLng(qsLng ? Number(qsLng) : null);
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
    url.searchParams.set('useGeoloc', '1');
    if (distanceKm != null) url.searchParams.set('distanceKm', String(distanceKm));
    if (lat != null && lng != null) { url.searchParams.set('lat', String(lat)); url.searchParams.set('lng', String(lng)); }
    url.searchParams.set('date', iso);
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

      {/* Header compact avec progression */}
      <div className="flex items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20 p-4 border-2 border-purple-200/50 dark:border-purple-800/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Date & Options</h1>
            <p className="text-sm text-muted-foreground">Étape 2 sur 3 : Choisis ta date</p>
          </div>
        </div>
        <Badge variant="secondary" className="bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400">
          Étape 2/3
        </Badge>
      </div>

      <Card className="border-2">
        <CardHeader>
          <CardTitle className="text-xl">Choix de la date</CardTitle>
          <CardDescription>Sélectionne aujourd&apos;hui, demain ou choisis mode flexible</CardDescription>
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
            <GraduationCap className="w-5 h-5 text-amber-600" />
            Cours avec un pro (optionnel)
          </CardTitle>
          <CardDescription>
            Signale aux autres riders et aux pros que tu cherches un cours
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
                Activer ce badge informe uniquement les autres riders en matching que tu cherches un cours. Coordinate-toi avec ton binôme pour éviter
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
            <MapPin className="w-5 h-5 text-sky-600" />
            Géolocalisation
          </CardTitle>
          <CardDescription>Active ta position pour trouver des riders proches de toi (nécessaire pour le matching)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl bg-blue-50/80 border border-blue-200 p-3 text-sm text-blue-800">
            La géolocalisation est nécessaire pour utiliser le matching et trouver des riders près de chez toi.
          </div>

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
                <p className="text-xs text-red-700">La géolocalisation est nécessaire pour le matching.</p>
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
                const url = new URL(window.location.href);
                url.searchParams.set('distanceKm', String(v));
                window.history.replaceState(null, '', url.toString());
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
                  const url = new URL(window.location.href);
                  url.searchParams.set('distanceKm', String(v));
                  window.history.replaceState(null, '', url.toString());
                }}
              >
                Reset 20 km
              </Button>
              <p className="text-xs text-muted-foreground">
                Plus le rayon est large, plus tu as de chance de matcher rapidement.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => router.push('/matching')}>
          Retour à la sélection
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          disabled={!dateISO || lat == null || lng == null}
          onClick={() => {
            const u = new URL(window.location.origin + '/matching/cards');
            if (sport) u.searchParams.set('sport', sport);
            if (level) u.searchParams.set('level', level);
            if (dateISO) u.searchParams.set('date', dateISO);
            if (wantsLesson) u.searchParams.set('wantsLesson', '1');
            u.searchParams.set('useGeoloc', '1');
            if (distanceKm != null) u.searchParams.set('distanceKm', String(distanceKm));
            if (lat != null && lng != null) { u.searchParams.set('lat', String(lat)); u.searchParams.set('lng', String(lng)); }
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
