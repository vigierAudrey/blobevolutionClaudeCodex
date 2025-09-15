"use client";
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import { useRouter } from 'next/navigation';

// Import dynamique de toute la carte pour éviter les problèmes SSR
const MapComponent = dynamic(() => import('../../../components/MapComponent'), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-100 rounded flex items-center justify-center">Chargement de la carte...</div>
});

export default function ProMapPage() {
  const router = useRouter();
  const [radiusKm, setRadiusKm] = useState(25);
  const [sport, setSport] = useState<'surf'|'kitesurf'>('surf');
  const [items, setItems] = useState<Array<any>>([]);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [hasGeolocPermission, setHasGeolocPermission] = useState(false);
  const [geolocEnabled, setGeolocEnabled] = useState(false);

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

  const load = async () => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) return;
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/near/lessons?radiusKm=${radiusKm}&sport=${sport}`, { headers: { Authorization: `Bearer ${t.accessToken}` }});
    const data = await r.json();
    if (r.ok) setItems(data.items || []);
  };

  useEffect(() => { load(); }, [radiusKm, sport]);


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

          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1 mr-4">
              <button className={`rounded-md border px-2 py-1 text-sm ${sport==='surf'?'border-primary ring-2 ring-primary':'border-input'}`} onClick={()=>setSport('surf')}>Surf</button>
              <button className={`rounded-md border px-2 py-1 text-sm ${sport==='kitesurf'?'border-primary ring-2 ring-primary':'border-input'}`} onClick={()=>setSport('kitesurf')}>Kitesurf</button>
            </div>
            <label className="text-sm">Rayon (km)</label>
            <Input type="number" min={1} max={200} value={radiusKm} onChange={(e)=> setRadiusKm(Number(e.target.value || 25))} className="w-24" disabled={!geolocEnabled} />
            <Button variant="outline" onClick={load} disabled={!geolocEnabled}>Rafraîchir</Button>
          </div>

          {geolocEnabled && center ? (
            <div className="space-y-2">
              <div className="text-sm text-green-600 mb-2">
                ✅ Géolocalisation active - {items.length} demande(s) trouvée(s) dans un rayon de {radiusKm}km
              </div>
              <MapComponent
                center={center}
                items={items}
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
