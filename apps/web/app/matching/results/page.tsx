"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { apiClient } from '../../../lib/apiClient';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import type { DashboardUser } from '@/types/user';
import type { MatchingCandidate, MatchingSearchParams, MatchingSearchResponse, Sport, Level } from '@/types';
import { Sparkles, ListChecks } from 'lucide-react';
import { clearMatchingStorage } from '../storage';

const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
  anytime: 'Peu importe'
};

const sportLabels: Record<Sport, string> = {
  surf: 'Surf',
  kitesurf: 'Kitesurf'
};

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
  const resetCriteria = useCallback(() => {
    clearMatchingStorage();
    router.push('/matching');
  }, [router]);

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
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/matching/date" />

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-8 text-white shadow-xl">
        <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_transparent_55%)]" aria-hidden />
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            Mode liste
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Résultats détaillés</h1>
          <p className="text-white/80 text-base max-w-2xl">
            Tu préfères comparer les fiches une à une ? Ce tableau synthétique reprend exactement la même sélection que ton deck.
          </p>
        </div>
      </section>

      <Card className="border-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-slate-100 text-slate-700">
              Synthèse
            </Badge>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-muted-foreground" />
              Résultats
            </CardTitle>
          </div>
          <CardDescription>
            {sport ? sportLabels[sport] : '—'} · {level ? levelLabels[level] : '—'} · {useGeoloc ? `${distanceKm ?? '—'} km` : 'sans géolocalisation'} · {date === 'anytime' ? 'peu importe' : date || '—'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground font-medium">Trier par :</span>
            {(['distance', 'name'] as const).map((key) => (
              <button
                key={key}
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                  sortBy === key ? 'border-slate-600 bg-slate-100 text-slate-900' : 'border-input hover:bg-accent'
                }`}
                onClick={() => { setPage(1); setData(null); setSortBy(key); }}
              >
                {key === 'distance' ? 'Distance' : 'Nom'}
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && !data && <p className="text-sm text-muted-foreground">Recherche en cours…</p>}

          {data && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground overflow-x-auto">
                Critères envoyés : <code>{JSON.stringify(data.criteria)}</code>
              </div>

              {(data.results ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Pas de résultats (mock). Prochaine étape : connecter la recherche réelle.
                </p>
              ) : (
                <div className="space-y-3">
                  {(data.results ?? []).map((r: MatchingCandidate) => (
                    <div key={r.id} className="rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {r.displayName}
                          {r.wantsLesson && (
                            <span title="Souhaite un cours" className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px]">🎓 Cours</span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {r.gender === 'FEMALE' ? 'Femme' : r.gender === 'MALE' ? 'Homme' : 'Autre'} • {r.sport ? sportLabels[r.sport as Sport] : r.sport} • {r.level ? levelLabels[r.level as Level] : r.level}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {r.distanceKm != null ? `${r.distanceKm} km` : 'Distance inconnue'}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground pt-2">
                <div>
                  Page {data.page ?? page}/{Math.max(1, Math.ceil((data.total ?? 0) / (data.pageSize ?? pageSize)))} — {data.total ?? 0} résultats
                </div>
                {data.hasMore && (
                  <Button variant="outline" onClick={() => setPage((p) => p + 1)}>Charger plus</Button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={resetCriteria}>
                  Modifier ma sélection
                </Button>
                <Button className="flex-1" onClick={() => router.push('/matching/cards')}>
                  Revenir au deck
                </Button>
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
