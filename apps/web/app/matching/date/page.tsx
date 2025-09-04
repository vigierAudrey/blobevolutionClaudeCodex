"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { BackBar } from '../../../components/BackBar';
import { Button } from '../../../components/ui/button';

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
const PARTNER_KEY = 'matching.partner';
const DATE_KEY = 'matching.date';
const DIST_KEY = 'matching.distanceKm';
const LAT_KEY = 'matching.lat';
const LNG_KEY = 'matching.lng';

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
  const [partner, setPartner] = useState<'ALL' | 'WOMEN' | 'MEN' | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);

  // Init from query/localStorage
  useEffect(() => {
    const qsSport = (search.get('sport') as Sport | null) || (localStorage.getItem(SPORT_KEY) as Sport | null);
    const qsLevel = (search.get('level') as Level | null) || (localStorage.getItem(LEVEL_KEY) as Level | null);
    const qsPartner = (search.get('partner') as 'ALL' | 'WOMEN' | 'MEN' | null) || (localStorage.getItem(PARTNER_KEY) as any);
    const qsDate = search.get('date') || localStorage.getItem(DATE_KEY);
    const qsDist = search.get('distanceKm') || localStorage.getItem(DIST_KEY);
    const qsLat = search.get('lat') || localStorage.getItem(LAT_KEY);
    const qsLng = search.get('lng') || localStorage.getItem(LNG_KEY);
    setSport(qsSport || null);
    setLevel(qsLevel || null);
    setPartner(qsPartner || 'ALL');
    setDateISO(qsDate || null);
    setDistanceKm(qsDist ? Number(qsDist) : null);
    setLat(qsLat ? Number(qsLat) : null);
    setLng(qsLng ? Number(qsLng) : null);
  }, [search]);

  // Guard: if sport/level missing, send back to matching
  useEffect(() => {
    if (sport && level) return;
    // minimal delay to avoid flash
    const t = setTimeout(() => router.replace('/matching'), 0);
    return () => clearTimeout(t);
  }, [router, sport, level]);

  const today = useMemo(() => new Date(), []);
  const tomorrow = useMemo(() => new Date(Date.now() + 24 * 60 * 60 * 1000), []);
  const after = useMemo(() => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), []);

  const setDatePersist = (iso: string) => {
    setDateISO(iso);
    try { localStorage.setItem(DATE_KEY, iso); } catch {}
    const url = new URL(window.location.href);
    if (sport) url.searchParams.set('sport', sport);
    if (level) url.searchParams.set('level', level);
    if (partner) url.searchParams.set('partner', partner);
    if (distanceKm != null) url.searchParams.set('distanceKm', String(distanceKm));
    if (lat != null && lng != null) { url.searchParams.set('lat', String(lat)); url.searchParams.set('lng', String(lng)); }
    url.searchParams.set('date', iso);
    window.history.replaceState(null, '', url.toString());
  };

  const breadcrumb = useMemo(() => {
    const dateStr = dateISO ? new Date(dateISO + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) : '—';
    const partnerShort = partner ? (partner === 'ALL' ? 'Peu importe' : partner === 'WOMEN' ? 'Femmes' : 'Hommes') : '—';
    const distShort = distanceKm != null ? `${distanceKm} km` : '—';
    return [sport ? sportLabels[sport] : '—', level ? levelLabels[level] : '—', partnerShort, distShort, dateStr].join(' > ');
  }, [sport, level, partner, distanceKm, dateISO]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/matching" />

      <div>
        <h1 className="text-2xl font-semibold">Choisis la date</h1>
        <p className="text-sm text-muted-foreground">Sélectionne l’un des trois prochains jours.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3) Date</CardTitle>
          <CardDescription>Jour même, lendemain ou surlendemain</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: formatDateISO(today), label: `Aujourd’hui (${formatDateDisplay(today)})` },
              { key: formatDateISO(tomorrow), label: `Demain (${formatDateDisplay(tomorrow)})` },
              { key: formatDateISO(after), label: `Après-demain (${formatDateDisplay(after)})` },
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
          <CardTitle className="text-base">Sélection actuelle</CardTitle>
          <CardDescription className="text-sm">{breadcrumb}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setDatePersist(formatDateISO(today))}>Choisir aujourd’hui</Button>
            <Button disabled={!dateISO} onClick={() => router.push(`/matching/results?sport=${sport}&level=${level}&partner=${partner}&distanceKm=${distanceKm ?? ''}&lat=${lat ?? ''}&lng=${lng ?? ''}&date=${dateISO}`)}>Continuer</Button>
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
