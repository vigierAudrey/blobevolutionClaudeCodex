"use client";
import dynamicImport from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import { useRouter } from 'next/navigation';

import { MapSkeleton } from '../../../components/ui/skeleton';

// Force SSR due to Leaflet map (dynamic import with ssr:false)
export const dynamic = 'force-dynamic';

// Import dynamique de toute la carte pour éviter les problèmes SSR
const MapComponent = dynamicImport(() => import('../../../components/MapComponent'), {
  ssr: false,
  loading: () => <MapSkeleton />
});

export default function ProMapPage() {
  const router = useRouter();
  const [radiusKm, setRadiusKm] = useState(25);
  const [sport, setSport] = useState<'surf'|'kitesurf'>('surf');
  const [items, setItems] = useState<Array<any>>([]);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [hasGeolocPermission, setHasGeolocPermission] = useState(false);
  const [geolocEnabled, setGeolocEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Load pro location via /pro/me
    const t = apiClient.getTokens();
    if (!t?.accessToken) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, { headers: { Authorization: `Bearer ${t.accessToken}` }})
      .then(async r => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (ok && body?.lat && body?.lng) {
          setCenter([body.lat, body.lng]);
          setGeolocEnabled(true);
          setHasGeolocPermission(true);
        }
      });
  }, []);

  const enableGeolocation = () => {
    if (!navigator.geolocation) {
      alert('La géolocalisation n\'est pas supportée par ce navigateur.');
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
          const t = apiClient.getTokens();
          if (t?.accessToken) {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${t.accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ lat, lng })
            });
          }
        } catch (error) {
          console.error('Erreur lors de la sauvegarde de la position:', error);
        }
      },
      (error) => {
        console.error('Erreur géolocalisation:', error);
        alert('Impossible de récupérer votre position. Vérifiez les autorisations de géolocalisation.');
        setHasGeolocPermission(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000 // 5 minutes
      }
    );
  };

  const load = useCallback(async () => {
    if (!geolocEnabled) return;

    setLoading(true);
    try {
      const t = apiClient.getTokens();
      if (!t?.accessToken) return;

      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/near/lessons?radiusKm=${radiusKm}&sport=${sport}`,
        { headers: { Authorization: `Bearer ${t.accessToken}` }}
      );
      const data = await r.json();
      if (r.ok) setItems(data.items || []);
    } catch (error) {
      console.error('Error loading lesson requests:', error);
    } finally {
      setLoading(false);
    }
  }, [radiusKm, sport, geolocEnabled]);

  // Debounced loading for better performance
  const debouncedLoad = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(load, 300); // 300ms debounce
  }, [load]);

  useEffect(() => {
    debouncedLoad();
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [debouncedLoad]);


  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>BloboMap – Demandes de cours</CardTitle>
        </CardHeader>
        <CardContent>
          {!geolocEnabled && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-md">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <span className="text-2xl">📍</span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900 mb-2">Géolocalisation requise</h3>
                  <p className="text-sm text-amber-800 mb-3">
                    Pour que la BloboMap fonctionne, vous devez activer votre géolocalisation.
                    Cela permettra de voir les demandes de cours autour de vous et de calculer les distances.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={enableGeolocation} className="bg-amber-600 hover:bg-amber-700">
                      🔄 Activer ma géolocalisation
                    </Button>
                  </div>
                  {hasGeolocPermission === false && (
                    <p className="text-xs text-amber-700 mt-2">
                      ⚠️ Autorisations refusées. Vérifiez les paramètres de votre navigateur.
                    </p>
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

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Rayon :</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value || 25))}
                className="w-20 text-center"
                disabled={!geolocEnabled}
                style={{ minHeight: '44px' }}
              />
              <span className="text-sm text-muted-foreground">km</span>
            </div>

            <Button
              variant="outline"
              onClick={load}
              disabled={!geolocEnabled || loading}
              className="touch-manipulation"
              style={{ minHeight: '44px' }}
            >
              {loading ? '🔄 Chargement...' : '🔄 Rafraîchir'}
            </Button>
          </div>

          {geolocEnabled && center ? (
            <div className="space-y-2">
              <div className="text-sm text-green-600 mb-2">
                ✅ Géolocalisation active - {items.length} demande(s) trouvée(s) dans un rayon de {radiusKm}km
              </div>
              <MapComponent
                center={center}
                items={items.map((item: any) => ({ ...item, type: 'rider' as const }))}
                legend={[
                  { label: 'Votre position', color: '#0ea5e9' },
                  { label: 'Demandes de riders', color: '#16a34a' },
                ]}
                centerMarker={{
                  label: 'Vous êtes ici',
                  description: `Rayon de ${radiusKm} km`,
                }}
                onContactClick={async (userId: string) => {
                  try {
                    const r = await apiClient.openConversation(userId);
                    router.push(`/messages/${r.id}`);
                  } catch (error) {
                    console.error('Erreur lors de l\'ouverture de la conversation:', error);
                  }
                }}
              />
            </div>
          ) : !geolocEnabled && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">⚠️ La BloboMap ne peut pas fonctionner sans géolocalisation</p>
              <p className="text-xs mt-1">Cliquez sur "Activer ma géolocalisation" ci-dessus</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
