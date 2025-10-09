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
    if (!navigator.geolocation) return alert('La géolocalisation n’est pas supportée par ce navigateur.');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); },
      () => { alert('Impossible de récupérer la position.'); },
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
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={getLocation}>Activer ma position</Button>
            <div className="text-xs text-muted-foreground">
              {lat != null && lng != null ? `Position: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Position non activée'}
            </div>
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
