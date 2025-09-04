"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { apiClient } from '../../../lib/apiClient';
import { Button } from '../../../components/ui/button';

function ResultsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const sport = sp.get('sport') as 'surf' | 'kitesurf' | null;
  const level = sp.get('level') as 'beginner' | 'intermediate' | 'advanced' | null;
  const partner = sp.get('partner') as 'ALL' | 'WOMEN' | 'MEN' | null;
  const date = sp.get('date');
  const distanceKm = sp.get('distanceKm');
  const lat = sp.get('lat');
  const lng = sp.get('lng');
  const [data, setData] = useState<{ criteria: any; results: any[]; total?: number; page?: number; pageSize?: number; hasMore?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [sortBy, setSortBy] = useState<'distance' | 'name'>('distance');

  useEffect(() => {
    if (!sport || !level || !date) return;
    const body: any = { sport, level, date, page, pageSize, sortBy };
    if (partner) body.partner = partner;
    if (distanceKm) body.distanceKm = Number(distanceKm);
    if (lat && lng) body.location = { lat: Number(lat), lng: Number(lng) };
    apiClient
      .searchMatching(body)
      .then(setData)
      .catch((e) => setError(e?.message || 'Erreur recherche'));
  }, [sport, level, date, partner, distanceKm, lat, lng, page, sortBy]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/matching/date" />
      <Card>
        <CardHeader>
          <CardTitle>Résultats</CardTitle>
          <CardDescription>
            Sélection: {sport || '—'} &gt; {level || '—'} &gt; {partner || '—'} &gt; {distanceKm ? `${distanceKm} km` : '—'} &gt; {date || '—'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Trier par:</span>
            <button
              className={`rounded-md border px-2 py-1 ${sortBy === 'distance' ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent'}`}
              onClick={() => { setPage(1); setData(null); setSortBy('distance'); }}
            >
              Distance
            </button>
            <button
              className={`rounded-md border px-2 py-1 ${sortBy === 'name' ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent'}`}
              onClick={() => { setPage(1); setData(null); setSortBy('name'); }}
            >
              Nom
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && !data && <p className="text-sm text-muted-foreground">Recherche en cours…</p>}
          {data && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Critères utilisés:</span>{' '}
                <code className="text-xs">{JSON.stringify(data.criteria)}</code>
              </div>
              {data.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">Pas de résultats (mock). Prochaine étape: recherche réelle.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {data.results.map((r) => (
                    <div key={r.id} className="rounded-md border p-3 text-sm flex items-center justify-between">
                      <div>
                        <div className="font-medium">{r.displayName}</div>
                        <div className="text-muted-foreground">
                          {r.gender === 'FEMALE' ? 'Femme' : 'Homme'} • {r.sport} • {r.level}
                        </div>
                      </div>
                      <div className="text-right text-muted-foreground">
                        {r.distanceKm != null ? `${r.distanceKm} km` : 'distance inconnue'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between pt-2 text-sm text-muted-foreground">
                <div>
                  Page {data.page ?? page}/{Math.max(1, Math.ceil((data.total ?? 0) / (data.pageSize ?? pageSize)))} — {data.total ?? 0} résultats
                </div>
                {data.hasMore && (
                  <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Charger plus</Button>
                )}
              </div>
              <div className="pt-2">
                <Button variant="outline" onClick={() => router.push('/matching')}>Modifier ma sélection</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto">Chargement…</div>}>
      <ResultsInner />
    </Suspense>
  );
}
