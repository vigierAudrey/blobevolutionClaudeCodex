"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BackBar } from '../../../components/BackBar';
import { apiClient } from '../../../lib/apiClient';
import type { DashboardUser } from '@/types/user';
import type { Level, Sport } from '@/types/matching';
import { CalendarDays, MapPin, AlertTriangle, GraduationCap } from 'lucide-react';
import { FRANCE_ONLY_INFO_MESSAGE } from '../../../lib/franceLaunch';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobPageHeader } from '@/components/blob';

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
        // No local hint check — truth comes from the server session.
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
        // Persiste la position sur le profil : /matching/search ne propose que
        // les profils avec lat/lng en base — sans cette écriture, le rider
        // reste invisible pour les autres (aucun match possible entre
        // nouveaux comptes). L'API ne réexpose jamais lat/lng aux autres
        // riders (distance arrondie uniquement).
        apiClient.updateProfile({ lat: la, lng: lo }).catch(() => {});
        const url = new URL(window.location.href);
        url.searchParams.set('lat', String(la)); url.searchParams.set('lng', String(lo));
        window.history.replaceState(null, '', url.toString());
      },
      () => {
        setGeolocError(true);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <BackBar fallbackHref="/matching" tone="blobDark" />

      <div className="space-y-4">
        <BlobBadge variant="yellow" size="md">Étape 2/3</BlobBadge>
        <BlobPageHeader
          title="Date et options"
          subtitle="Choisis la date de ta session puis active la position nécessaire à la recherche."
        />
      </div>

      <BlobAlert variant="warning" title="Zone de lancement">
        {FRANCE_ONLY_INFO_MESSAGE}
      </BlobAlert>

      <BlobCard mode="white" className="motion-safe:hover:translate-y-0">
        <div className="space-y-5">
          <header className="border-b-2 border-blob-sand-deep pb-5 dark:border-white/10">
            <div className="flex items-center gap-3">
              <CalendarDays className="h-6 w-6" aria-hidden="true" />
              <h2 className="text-xl font-black uppercase tracking-widest">Choix de la date</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-blob-black/70 dark:text-white/70">
              Sélectionne aujourd&apos;hui, demain ou choisis le mode flexible.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { key: formatDateISO(today), label: `Aujourd'hui (${formatDateDisplay(today)})` },
              { key: formatDateISO(tomorrow), label: `Demain (${formatDateDisplay(tomorrow)})` },
              { key: 'anytime', label: '🗓️ Peu importe' },
            ].map((d) => (
              <button
                type="button"
                key={d.key}
                onClick={() => setDatePersist(d.key)}
                aria-pressed={dateISO === d.key}
                className={`min-h-16 rounded-sm border-2 px-4 py-4 text-left text-sm font-black uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 ${
                  dateISO === d.key
                    ? 'border-blob-black bg-blob-yellow text-blob-black dark:border-blob-yellow'
                    : 'border-blob-sand-deep bg-blob-sand text-blob-black hover:border-blob-black dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-white/60'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="rounded-sm border-2 border-blob-sand-deep bg-blob-sand px-4 py-3 text-sm text-blob-black/70 dark:border-white/10 dark:bg-white/5 dark:text-white/70" aria-live="polite">
            {dateISO
              ? dateISO === 'anytime'
                ? 'Mode flexible : nous te proposons les meilleurs matchs sans contrainte de date.'
                : `Date sélectionnée : ${dateISO}`
              : 'Sélectionne un créneau pour débloquer la suite.'}
          </div>
        </div>
      </BlobCard>

      <BlobCard mode="sand" className="motion-safe:hover:translate-y-0">
        <div className="space-y-4">
          <header>
            <div className="flex items-center gap-3">
              <GraduationCap className="h-6 w-6" aria-hidden="true" />
              <h2 className="text-xl font-black uppercase tracking-widest">Cours avec un pro</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-blob-black/70 dark:text-white/70">
              Optionnel : signale aux autres riders et aux pros que tu cherches un cours.
            </p>
          </header>
          <label className="flex min-h-12 items-start gap-3 rounded-sm border-2 border-blob-sand-deep bg-white p-3 text-sm font-medium dark:border-white/15 dark:bg-white/5">
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
              className="mt-0.5 h-5 w-5 shrink-0 accent-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
            />
            <span>Je veux un cours avec un professionnel sur cette session</span>
          </label>

          {wantsLesson && (
            <BlobAlert variant="info" title="Demande de cours">
              <div className="space-y-2">
              <p>
                Activer ce badge informe uniquement les autres riders en matching que tu cherches un cours. Coordinate-toi avec ton binôme pour éviter
                les doublons.
              </p>
              <p>
                Pour publier une demande visible sur la BloboMap, remplis{' '}
                <Link href="/lesson-request" className="font-black underline underline-offset-2">
                  le formulaire dédié
                </Link>
                . Un seul formulaire par groupe suffit.
              </p>
              <p className="italic">Aucun cours n’est réservé automatiquement pour le moment.</p>
              </div>
            </BlobAlert>
          )}
        </div>
      </BlobCard>

      <BlobCard mode="white" className="motion-safe:hover:translate-y-0">
        <div className="space-y-5">
          <header className="border-b-2 border-blob-sand-deep pb-5 dark:border-white/10">
            <div className="flex items-center gap-3">
              <MapPin className="h-6 w-6" aria-hidden="true" />
              <h2 className="text-xl font-black uppercase tracking-widest">Géolocalisation</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-blob-black/70 dark:text-white/70">
              Active ta position pour trouver des riders proches de toi.
            </p>
          </header>
          <BlobAlert variant="info" title="Position requise">
            La géolocalisation est nécessaire pour utiliser le matching et trouver des riders près de chez toi.
          </BlobAlert>

          <div className="space-y-3">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <BlobButton variant="outlineDark" size="sm" onClick={getLocation} className="w-full sm:w-auto">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Activer ma position
              </BlobButton>
              <span className="break-all text-xs text-blob-black/64 dark:text-white/64" aria-live="polite">
                {lat != null && lng != null ? `Position : ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Position non activée'}
              </span>
            </div>
            {geolocError && (
              <BlobAlert variant="error" title={`Autorise la localisation sur ${getBrowserInstructions(browserType).title}`}>
                <div className="space-y-3">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  Vérifie les autorisations de ton navigateur.
                </p>
                <ol className="list-decimal space-y-1 pl-4">
                  {getBrowserInstructions(browserType).steps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
                <p className="text-xs">La géolocalisation est nécessaire pour le matching.</p>
                <BlobButton onClick={getLocation} variant="outlineDark" size="sm">
                  Réessayer
                </BlobButton>
                </div>
              </BlobAlert>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="distance">Distance maximale</label>
              <span className="font-black">{distanceKm ?? 20} km</span>
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
              className="w-full accent-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
            />
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <BlobButton
                variant="outlineDark"
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
                Réinitialiser à 20 km
              </BlobButton>
              <p className="text-xs text-blob-black/64 dark:text-white/64">
                Plus le rayon est large, plus tu as de chance de matcher rapidement.
              </p>
            </div>
          </div>
        </div>
      </BlobCard>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <BlobButton variant="outlineDark" size="md" className="w-full sm:w-auto" onClick={() => router.push('/matching')}>
          Retour à la sélection
        </BlobButton>
        <BlobButton
          size="md"
          className="w-full sm:w-auto"
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
        </BlobButton>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<BlobCard mode="white" aria-live="polite">Chargement…</BlobCard>}>
      <DateInner />
    </Suspense>
  );
}
