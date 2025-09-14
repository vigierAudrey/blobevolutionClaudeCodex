"use client";
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import { useRouter } from 'next/navigation';

const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(m => m.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then(m => m.Popup), { ssr: false });

export default function ProMapPage() {
  const router = useRouter();
  const [radiusKm, setRadiusKm] = useState(25);
  const [sport, setSport] = useState<'surf'|'kitesurf'>('surf');
  const [items, setItems] = useState<Array<any>>([]);
  const [center, setCenter] = useState<[number, number] | null>(null);

  useEffect(() => {
    // Load pro location via /pro/me
    const t = apiClient.getTokens();
    if (!t?.accessToken) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, { headers: { Authorization: `Bearer ${t.accessToken}` }})
      .then(async r => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => { if (ok && body?.lat && body?.lng) setCenter([body.lat, body.lng]); });
  }, []);

  const load = async () => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) return;
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/near/lessons?radiusKm=${radiusKm}&sport=${sport}`, { headers: { Authorization: `Bearer ${t.accessToken}` }});
    const data = await r.json();
    if (r.ok) setItems(data.items || []);
  };

  useEffect(() => { load(); }, [radiusKm, sport]);

  const mapStyle = { height: '60vh', width: '100%' } as const;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <Card>
        <CardHeader>
          <CardTitle>BloboMap – Demandes de cours</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1 mr-4">
              <button className={`rounded-md border px-2 py-1 text-sm ${sport==='surf'?'border-primary ring-2 ring-primary':'border-input'}`} onClick={()=>setSport('surf')}>Surf</button>
              <button className={`rounded-md border px-2 py-1 text-sm ${sport==='kitesurf'?'border-primary ring-2 ring-primary':'border-input'}`} onClick={()=>setSport('kitesurf')}>Kitesurf</button>
            </div>
            <label className="text-sm">Rayon (km)</label>
            <Input type="number" min={1} max={200} value={radiusKm} onChange={(e)=> setRadiusKm(Number(e.target.value || 25))} className="w-24" />
            <Button variant="outline" onClick={load}>Rafraîchir</Button>
          </div>

          {center && (
            <>
              <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossOrigin="" />
              <MapContainer center={center} zoom={11} style={mapStyle} scrollWheelZoom>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                {items.map((it: any) => (
                  <Marker key={it.id} position={[it.lat, it.lng]}>
                    <Popup>
                      <div className="text-sm">
                        <div className="font-medium">{it.displayName || 'Rider'}</div>
                        <div className="text-muted-foreground">à ~{it.distanceKm} km</div>
                        <div className="mt-2">
                          <button className="underline text-primary" onClick={async ()=>{
                            try {
                              const r = await apiClient.openConversation(it.userId);
                              router.push(`/messages/${r.id}`);
                            } catch {}
                          }}>Contacter</button>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </>
          )}
          {!center && <p className="text-sm text-muted-foreground">Renseigne ton lieu de travail dans le profil pro pour activer la carte.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
