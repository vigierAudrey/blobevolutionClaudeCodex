"use client";
import dynamicImport from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import { useRouter } from 'next/navigation';
import { useToast } from '../../../components/ui/toast';

import { MapSkeleton } from '../../../components/ui/skeleton';
import type { LessonRequest, LessonRequestResponse } from '@/types/pro';
import { FRANCE_ONLY_COUNTRY_CODE, PRO_BETA_INFO_MESSAGE } from '../../../lib/franceLaunch';

// Force SSR due to Leaflet map (dynamic import with ssr:false)
export const dynamic = 'force-dynamic';

// Import dynamique de toute la carte pour éviter les problèmes SSR
const MapComponent = dynamicImport(() => import('../../../components/MapComponent'), {
  ssr: false,
  loading: () => <MapSkeleton />
});

// Fonction pour détecter le navigateur de l'utilisateur
type BrowserType = 'chrome' | 'firefox' | 'safari' | 'edge' | 'other';

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
          'Trouvez &quot;Position&quot; ou &quot;Localisation&quot;',
          'Changez de &quot;Bloquer&quot; à &quot;Autoriser&quot;',
          'Rechargez la page avec F5'
        ]
      };
    case 'edge':
      return {
        title: 'Edge',
        steps: [
          'Cliquez sur l’icône 🔒 à gauche de l’adresse URL',
          'Trouvez &quot;Autorisations pour ce site&quot;',
          'Changez &quot;Emplacement&quot; à &quot;Autoriser&quot;',
          'Rechargez la page avec F5'
        ]
      };
    case 'firefox':
      return {
        title: 'Firefox',
        steps: [
          'Cliquez sur l’icône 🔒 à gauche de l’adresse URL',
          'Cliquez sur &quot;Permissions&quot; puis &quot;Position&quot;',
          'Décochez &quot;Bloquer&quot; ou sélectionnez &quot;Autoriser&quot;',
          'Rechargez la page avec F5'
        ]
      };
    case 'safari':
      return {
        title: 'Safari',
        steps: [
          'Ouvrez Safari > Réglages > Sites web',
          'Dans la section &quot;Localisation&quot;, trouvez ce site',
          'Changez à &quot;Autoriser&quot;',
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

export default function ProMapPage() {
  const router = useRouter();
  const toast = useToast();
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [sport, setSport] = useState<'surf' | 'kitesurf'>('surf');
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
      <BackBar fallbackHref="/pro/dashboard" />

      {/* Header compact avec style océan */}
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-cyan-100 to-blue-100 dark:from-cyan-900/20 dark:to-blue-900/20 p-4 border-2 border-cyan-200/50 dark:border-cyan-800/50">
        <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 text-white shadow-md">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">BloboMap – Demandes de cours 🗺️</h1>
          <p className="text-sm text-muted-foreground">Trouve des riders autour de toi qui cherchent un coach</p>
        </div>
      </div>

      <Card className="border-2 rounded-[1.75rem]">
        <CardHeader className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/30 dark:to-blue-950/30">
          <CardTitle className="text-foreground">Carte interactive des demandes</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
            {PRO_BETA_INFO_MESSAGE}
          </div>
          {apiError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300" role="alert">
              {apiError}
            </div>
          )}
          {!geolocEnabled && (
            <div className="mb-4 rounded-2xl border-2 border-amber-200 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <span className="text-2xl">📍</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">Géolocalisation requise</h3>
                  <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                    Pour que la BloboMap fonctionne, tu dois activer ta géolocalisation.
                    Cela permettra de voir les demandes de cours autour de toi et de calculer les distances.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={enableGeolocation} className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700">
                      🔄 Activer ma géolocalisation
                    </Button>
                  </div>
                  {hasGeolocPermission === false && (
                    <div className="mt-4 rounded-2xl border-2 border-red-200 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 p-4">
                      <h4 className="font-semibold text-red-900 dark:text-red-100 mb-2 flex items-center gap-2">
                        <span>⚠️</span>
                        <span>Autorisations refusées - Comment débloquer</span>
                      </h4>
                      <p className="text-sm text-red-800 dark:text-red-200 mb-3">
                        Ton navigateur bloque l&apos;accès à ta position. Pour débloquer, suis ces étapes pour {getBrowserInstructions(browserType).title} :
                      </p>
                      <ol className="text-sm text-red-800 dark:text-red-200 space-y-1 ml-4">
                        {getBrowserInstructions(browserType).steps.map((step, idx) => (
                          <li key={idx} className="list-decimal">
                            {step}
                          </li>
                        ))}
                      </ol>
                      <p className="text-xs text-red-700 dark:text-red-300 mt-3 italic">
                        💡 Astuce : Cette protection est normale, elle protège ta vie privée. Nous ne sauvegarderons ta position que si tu coches &quot;Enregistrer comme position par défaut&quot;.
                      </p>
                      <Button
                        onClick={enableGeolocation}
                        className="mt-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700"
                        size="sm"
                      >
                        🔄 Réessayer après avoir autorisé
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Sport :</span>
              <div className="flex items-center gap-1">
                <button
                  className={`rounded-md border px-4 py-2 text-sm font-medium touch-manipulation ${
                    sport === 'surf' ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent'
                  }`}
                  onClick={() => setSport('surf')}
                  style={{ minHeight: '44px' }}
                >
                  🏄 Surf
                </button>
                <button
                  className={`rounded-md border px-4 py-2 text-sm font-medium touch-manipulation ${
                    sport === 'kitesurf' ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent'
                  }`}
                  onClick={() => setSport('kitesurf')}
                  style={{ minHeight: '44px' }}
                >
                  🪁 Kitesurf
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label htmlFor="radiusKm" className="text-sm font-medium">Rayon :</label>
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
                  className="w-20 text-center"
                  disabled={radiusKm === null}
                  style={{ minHeight: '44px' }}
                />
                <span className="text-sm text-muted-foreground">km</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Le rayon sélectionné s’applique pour le surf et le kite.
              </p>
            </div>

            <Button
              variant="outline"
              onClick={load}
              disabled={!geolocEnabled || loading || radiusKm === null}
              className="touch-manipulation"
              style={{ minHeight: '44px' }}
            >
              {loading ? '🔄 Chargement...' : '🔄 Rafraîchir'}
            </Button>
          </div>

          {geolocEnabled && center ? (
            <div className="space-y-2">
              <div className="text-sm text-green-600 mb-2">
                ✅ Géolocalisation active – {items.length} demande(s) trouvée(s) dans un rayon de {radiusKm ?? 25} km {radiusSaving ? '(sauvegarde…)' : ''}
              </div>
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
                  { label: 'Votre position', color: '#0ea5e9' },
                  { label: 'Demandes de riders', color: '#16a34a' },
                ]}
                centerMarker={{
                  label: 'Vous êtes ici',
                  description: `Rayon de ${radiusKm ?? 25} km`,
                }}
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
                  }
                }}
              />
            </div>
          ) : !geolocEnabled && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">⚠️ La BloboMap ne peut pas fonctionner sans géolocalisation</p>
              <p className="text-xs mt-1">Cliquez sur &quot;Activer ma géolocalisation&quot; ci-dessus</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
