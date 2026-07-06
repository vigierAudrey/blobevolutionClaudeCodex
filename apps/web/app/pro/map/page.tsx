"use client";
import dynamicImport from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackBar } from '../../../components/BackBar';
import { Input } from '../../../components/ui/input';
import { apiClient } from '../../../lib/apiClient';
import { useRouter } from 'next/navigation';
import { useToast } from '../../../components/ui/toast';
import { AlertTriangle, LocateFixed, Map, RefreshCw, Waves, Wind } from 'lucide-react';

import { MapSkeleton } from '../../../components/ui/skeleton';
import type { LessonRequest, LessonRequestResponse } from '@/types/pro';
import { FRANCE_ONLY_COUNTRY_CODE, PRO_BETA_INFO_MESSAGE } from '../../../lib/franceLaunch';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobEmptyState, BlobMark } from '@/components/blob';

// Force SSR due to Leaflet map (dynamic import with ssr:false)
export const dynamic = 'force-dynamic';

// Import dynamique de toute la carte pour éviter les problèmes SSR
const MapComponent = dynamicImport(() => import('../../../components/MapComponent'), {
  ssr: false,
  loading: () => <MapSkeleton />
});

// Fonction pour détecter le navigateur de l'utilisateur
type BrowserType = 'chrome' | 'firefox' | 'safari' | 'edge' | 'other';
type SportFilter = 'surf' | 'kitesurf';

const detectBrowser = (): BrowserType => {
  if (typeof window === 'undefined') return 'other';

  const userAgent = window.navigator.userAgent.toLowerCase();

  if (userAgent.includes('edg/')) return 'edge';
  if (userAgent.includes('chrome') && !userAgent.includes('edg/')) return 'chrome';
  if (userAgent.includes('firefox')) return 'firefox';
  if (userAgent.includes('safari') && !userAgent.includes('chrome')) return 'safari';

  return 'other';
};

// Instructions selon le navigateur
const getBrowserInstructions = (browser: BrowserType): { title: string; steps: string[] } => {
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
          'Autorisez l’accès à votre position',
          'Rechargez la page'
        ]
      };
  }
};

const getApiMessage = (body: unknown, fallback: string) => {
  if (body && typeof body === 'object') {
    const data = body as { message?: unknown; error?: unknown };
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
  }
  return fallback;
};

const sportButtonClass = (active: boolean) =>
  [
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-sm border-2 px-4 py-2 text-xs font-black uppercase tracking-widest transition-colors touch-manipulation',
    active
      ? 'border-blob-black bg-blob-yellow text-blob-black'
      : 'border-blob-black/20 bg-white text-blob-black hover:border-blob-yellow dark:border-white/20 dark:bg-white/5 dark:text-white',
  ].join(' ');

export default function ProMapPage() {
  const router = useRouter();
  const toast = useToast();
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [sport, setSport] = useState<SportFilter>('surf');
  const [items, setItems] = useState<LessonRequest[]>([]);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [hasGeolocPermission, setHasGeolocPermission] = useState<boolean | null>(null);
  const [geolocEnabled, setGeolocEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [browserType, setBrowserType] = useState<BrowserType>('other');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const radiusPersistRef = useRef<ReturnType<typeof setTimeout>>();
  const lastSavedRadiusRef = useRef<number | null>(null);
  const [radiusSaving, setRadiusSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    // Détecter le navigateur au montage du composant
    setBrowserType(detectBrowser());

    // Load pro location via /pro/me (cookie auth)
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, { credentials: 'include' })
      .then(async r => ({ ok: r.ok, status: r.status, body: await r.json() }))
      .then(({ ok, status, body }) => {
        if (status === 401) { router.replace('/login'); return; }
        if (status === 403) { router.replace('/dashboard'); return; }
        if (ok && body?.lat && body?.lng) {
          setCenter([body.lat, body.lng]);
          setGeolocEnabled(true);
          setHasGeolocPermission(true);
        }
        if (ok) {
          setApiError(null);
          const storedRadius = typeof body?.radiusKm === 'number' ? body.radiusKm : 25;
          const clamped = Math.max(1, Math.min(200, storedRadius));
          setRadiusKm(clamped);
          lastSavedRadiusRef.current = clamped;
        } else {
          setApiError(getApiMessage(body, 'Impossible de charger votre profil pro.'));
          setRadiusKm(25);
          lastSavedRadiusRef.current = 25;
        }
      })
      .catch(() => {
        setRadiusKm(25);
        lastSavedRadiusRef.current = 25;
      });
  }, [router]);

  const enableGeolocation = () => {
    if (!navigator.geolocation) {
      alert('La géolocalisation n’est pas supportée par ce navigateur.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCenter([lat, lng]);
        setGeolocEnabled(true);
        setHasGeolocPermission(true);

        // Sauvegarder la position dans le profil pro
        try {
          const csrfRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/csrf-token`, { credentials: 'include' });
          const { csrfToken = '' } = await csrfRes.json().catch(() => ({})) as { csrfToken?: string };
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, {
            method: 'PUT',
            headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ countryCode: FRANCE_ONLY_COUNTRY_CODE, lat, lng })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(getApiMessage(body, 'Impossible de sauvegarder votre position.'));
          }
          setApiError(null);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Impossible de sauvegarder votre position.';
          setApiError(message);
          toast(message, 'error');
          console.error('Erreur lors de la sauvegarde de la position :', error);
        }
      },
      (error) => {
        console.error('Erreur géolocalisation :', error);
        setHasGeolocPermission(false);
        setGeolocEnabled(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes
      }
    );
  };

  const load = useCallback(async () => {
    if (!geolocEnabled || radiusKm === null) return;

    setLoading(true);
    setApiError(null);
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/near/lessons?radiusKm=${radiusKm}&sport=${sport}`,
        { credentials: 'include' },
      );
      const data = (await r.json()) as LessonRequestResponse;
      if (r.ok) {
        setItems(data.items ?? []);
      } else {
        const message = getApiMessage(data, 'Impossible de charger les demandes autour de vous.');
        setItems([]);
        setApiError(message);
        toast(message, 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Impossible de charger les demandes autour de vous.';
      setApiError(message);
      console.error('Error loading lesson requests:', error);
    } finally {
      setLoading(false);
    }
  }, [radiusKm, sport, geolocEnabled, toast]);

  // Debounced loading for better performance
  const debouncedLoad = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(load, 300); // 300ms debounce
  }, [load]);

  useEffect(() => {
    if (radiusKm !== null) {
      debouncedLoad();
    }
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [debouncedLoad, radiusKm]);

  useEffect(() => {
    if (radiusKm === null) return;
    if (lastSavedRadiusRef.current === null) {
      lastSavedRadiusRef.current = radiusKm;
      return;
    }
    if (lastSavedRadiusRef.current === radiusKm) return;

    const persist = async () => {
      try {
        const csrfRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/csrf-token`, { credentials: 'include' });
        const { csrfToken = '' } = await csrfRes.json().catch(() => ({})) as { csrfToken?: string };
        setRadiusSaving(true);
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, {
          method: 'PATCH',
          headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ countryCode: FRANCE_ONLY_COUNTRY_CODE, radiusKm })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(getApiMessage(body, 'Impossible de sauvegarder votre rayon.'));
        }
        lastSavedRadiusRef.current = radiusKm;
        setApiError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Impossible de sauvegarder votre rayon.';
        setApiError(message);
        toast(message, 'error');
        console.error('Erreur lors de la sauvegarde du rayon :', error);
      } finally {
        setRadiusSaving(false);
      }
    };

    if (radiusPersistRef.current) {
      clearTimeout(radiusPersistRef.current);
    }
    radiusPersistRef.current = setTimeout(persist, 500);

    return () => {
      if (radiusPersistRef.current) {
        clearTimeout(radiusPersistRef.current);
      }
    };
  }, [radiusKm, toast]);


  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" tone="blobDark" />

      <BlobCard mode="yellowSignal">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
            <BlobMark size={26} decorative />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-black uppercase tracking-widest text-blob-black">BloboMap</h1>
              <BlobBadge variant="dark">Demandes de cours</BlobBadge>
            </div>
            <p className="mt-2 text-sm leading-6 text-blob-black/72">
              Trouve les riders autour de toi qui cherchent un coach.
            </p>
          </div>
        </div>
      </BlobCard>

      <BlobCard mode="white" className="motion-safe:hover:translate-y-0">
        <div className="border-b-2 border-blob-sand-deep bg-blob-sand px-5 py-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
              <Map className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-black uppercase tracking-widest text-blob-black dark:text-white">
                Carte interactive des demandes
              </h2>
              <p className="mt-1 text-sm leading-6 text-blob-black/64 dark:text-white/60">
                Filtre par sport et rayon sans quitter la carte.
              </p>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="mb-4">
            <BlobAlert variant="warning" title="Bêta France">
              {PRO_BETA_INFO_MESSAGE}
            </BlobAlert>
          </div>
          {apiError && (
            <div className="mb-4">
              <BlobAlert variant="error" title="Erreur BloboMap">{apiError}</BlobAlert>
            </div>
          )}
          {!geolocEnabled && (
            <div className="mb-4 rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 p-4 text-blob-black dark:bg-blob-yellow/10 dark:text-white">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                  <LocateFixed className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-black uppercase tracking-wide">Géolocalisation requise</h3>
                  <p className="mt-2 text-sm leading-6 text-blob-black/75 dark:text-white/70">
                    Pour que la BloboMap fonctionne, tu dois activer ta géolocalisation.
                    Cela permet de voir les demandes de cours autour de toi et de calculer les distances.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <BlobButton onClick={enableGeolocation} size="sm" variant="yellowSignalDark">
                      <LocateFixed className="h-4 w-4" />
                      Activer ma géolocalisation
                    </BlobButton>
                  </div>
                  {hasGeolocPermission === false && (
                    <div className="mt-4 rounded-sm border-2 border-red-800 bg-red-50 p-4 text-red-950 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100">
                      <h4 className="flex items-center gap-2 font-black uppercase tracking-wide">
                        <AlertTriangle className="h-4 w-4" />
                        Autorisations refusées
                      </h4>
                      <p className="mt-2 text-sm leading-6">
                        Ton navigateur bloque l&apos;accès à ta position. Pour débloquer, suis ces étapes pour {getBrowserInstructions(browserType).title} :
                      </p>
                      <ol className="mt-3 space-y-1 pl-5 text-sm">
                        {getBrowserInstructions(browserType).steps.map((step, idx) => (
                          <li key={idx} className="list-decimal">
                            {step}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-3 text-xs leading-5">
                        Cette protection est normale: elle protège ta vie privée. Nous ne sauvegardons ta position que pour afficher ton activité Pro dans les recherches à proximité.
                      </p>
                      <BlobButton
                        onClick={enableGeolocation}
                        className="mt-3"
                        size="sm"
                        variant="outlineDark"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Réessayer
                      </BlobButton>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-widest text-blob-black/60 dark:text-white/55">Sport</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={sportButtonClass(sport === 'surf')}
                  onClick={() => setSport('surf')}
                >
                  <Waves className="h-4 w-4" />
                  Surf
                </button>
                <button
                  type="button"
                  className={sportButtonClass(sport === 'kitesurf')}
                  onClick={() => setSport('kitesurf')}
                >
                  <Wind className="h-4 w-4" />
                  Kitesurf
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="space-y-1">
                <label htmlFor="radiusKm" className="text-xs font-black uppercase tracking-widest text-blob-black/60 dark:text-white/55">Rayon</label>
                <div className="flex items-center gap-2">
                  <Input
                    id="radiusKm"
                    type="number"
                    min={1}
                    max={200}
                    value={radiusKm ?? ''}
                    onChange={(e) => {
                      const nextValue = Number(e.target.value);
                      if (!Number.isFinite(nextValue)) {
                        setRadiusKm(25);
                        return;
                      }
                      setRadiusKm(Math.max(1, Math.min(200, nextValue)));
                    }}
                    className="min-h-11 w-24 rounded-sm border-2 border-blob-black/20 bg-white text-center font-bold text-blob-black focus-visible:ring-blob-yellow dark:border-white/20 dark:bg-white/5 dark:text-white"
                    disabled={radiusKm === null}
                  />
                  <span className="text-sm font-bold text-blob-black/64 dark:text-white/60">km</span>
                </div>
                <p className="text-xs text-blob-black/60 dark:text-white/55">
                  Le rayon sélectionné s’applique pour le surf et le kite.
                </p>
              </div>

              <BlobButton
                variant="outlineDark"
                size="sm"
                onClick={load}
                disabled={!geolocEnabled || loading || radiusKm === null}
                className="min-h-11"
              >
                <RefreshCw className="h-4 w-4" />
                {loading ? 'Chargement...' : 'Rafraîchir'}
              </BlobButton>
            </div>
          </div>

          {geolocEnabled && center ? (
            <div className="space-y-3">
              <BlobAlert variant="success" title="Géolocalisation active">
                {items.length} demande{items.length !== 1 ? 's' : ''} trouvée{items.length !== 1 ? 's' : ''} dans un rayon de {radiusKm ?? 25} km {radiusSaving ? '(sauvegarde...)' : ''}
              </BlobAlert>
              <div className="overflow-hidden rounded-sm border-2 border-blob-sand-deep dark:border-white/10">
                <MapComponent
                  center={center}
                  items={items
                    .filter((item) => item.lessonLatApprox != null && item.lessonLngApprox != null)
                    .map((item) => ({
                      ...item,
                      // Le pin est positionné sur le lieu demandé pour le cours,
                      // pas sur les coordonnées du profil rider.
                      lat: item.lessonLatApprox as number,
                      lng: item.lessonLngApprox as number,
                      displayName: item.displayName ?? undefined,
                      type: 'rider' as const,
                    }))}
                  legend={[
                    { label: 'Votre position', color: '#111111' },
                    { label: 'Demandes de riders', color: '#fbbf24' },
                  ]}
                  centerMarker={{
                    label: 'Vous êtes ici',
                    description: `Rayon de ${radiusKm ?? 25} km`,
                  }}
                  radiusKm={radiusKm ?? undefined}
                  onContactClick={async (userId: string) => {
                    try {
                      const r = await apiClient.openConversation(userId);
                      const conversationId =
                        typeof r === 'object' &&
                        r !== null &&
                        'id' in r &&
                        typeof r.id === 'string'
                          ? r.id
                          : null;
                      if (!conversationId) {
                        throw new Error('Réponse invalide: conversation sans identifiant');
                      }
                      router.push(`/messages/${conversationId}`);
                    } catch (error) {
                      console.error('Erreur lors de l’ouverture de la conversation :', error);
                      toast('Impossible d’ouvrir la conversation. Réessaie dans un instant.', 'error');
                    }
                  }}
                />
              </div>
            </div>
          ) : !geolocEnabled && (
            <BlobEmptyState
              title="Position nécessaire"
              description="La BloboMap ne peut pas fonctionner sans géolocalisation. Active ta position pour afficher les demandes autour de toi."
              action={
                <BlobButton onClick={enableGeolocation} size="sm">
                  <LocateFixed className="h-4 w-4" />
                  Activer ma position
                </BlobButton>
              }
            />
          )}
        </div>
      </BlobCard>
    </div>
  );
}
