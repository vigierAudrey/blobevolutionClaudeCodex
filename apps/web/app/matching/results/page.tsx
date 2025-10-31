"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { apiClient } from '../../../lib/apiClient';
import { Button } from '../../../components/ui/button';
import type { DashboardUser } from '@/types/user';
import type { MatchingCandidate, MatchingSearchParams, MatchingSearchResponse, Sport, Level } from '@/types';

function ResultsInner() {
  const router = useRouter();
  const sp = useSearchParams();

  // Vérifier le rôle utilisateur
  useEffect(() => {
    (async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const user = await apiClient.me() as DashboardUser;
        if (user.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);
  const sport = sp.get('sport') as Sport | null;
  const level = sp.get('level') as Level | null;
  const date = sp.get('date');
  const distanceKm = sp.get('distanceKm');
  const lat = sp.get('lat');
  const lng = sp.get('lng');
  const useGeoloc = sp.get('useGeoloc') === '1';
  type MatchingResults = MatchingSearchResponse & {
    criteria?: Partial<MatchingSearchParams>;
    total?: number;
    page?: number;
    pageSize?: number;
  };
  const [data, setData] = useState<MatchingResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [sortBy, setSortBy] = useState<'distance' | 'name'>('distance');

  const loadResults = useCallback(async () => {
    if (!sport || !level || !date) return;
    const payload: MatchingSearchParams & { page: number; pageSize: number } = {
      sport,
      level,
      date,
      sortBy,
      excludeIds: [],
      limit: pageSize,
      page,
      pageSize,
    };
    if (useGeoloc && distanceKm) payload.distanceKm = Number(distanceKm);
    if (useGeoloc && lat && lng) payload.location = { lat: Number(lat), lng: Number(lng) };

    try {
      const response = await apiClient.searchMatching(payload) as MatchingResults;
      setData(response);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur recherche');
    }
  }, [sport, level, date, sortBy, pageSize, page, useGeoloc, distanceKm, lat, lng]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/matching/date" />
      <Card>
        <CardHeader>
          <CardTitle>Résultats</CardTitle>
          <CardDescription>
            Sélection : {sport || '—'} &gt; {level || '—'} &gt; {useGeoloc ? (distanceKm ? `${distanceKm} km` : '—') : 'sans géolocalisation'} &gt; {date || '—'}
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
                <span className="text-muted-foreground">Critères utilisés :</span>{' '}
                <code className="text-xs">{JSON.stringify(data.criteria)}</code>
              </div>
              { (data.results ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Pas de résultats (mock). Prochaine étape : recherche réelle.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {(data.results ?? []).map((r: MatchingCandidate) => (
                    <div key={r.id} className="rounded-md border p-3 text-sm flex items-center justify-between">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {r.displayName}
                          {r.wantsLesson && (
                            <span title="Souhaite un cours" className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px]">🎓 Cours</span>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {r.gender === 'FEMALE' ? 'Femme' : r.gender === 'MALE' ? 'Homme' : 'Autre'} • {r.sport} • {r.level}
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
