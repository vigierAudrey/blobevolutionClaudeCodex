"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import { Spinner } from '../../../components/ui/spinner';
import { useToast } from '../../../components/ui/toast';
import Link from 'next/link';

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';

function CardsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const sport = sp.get('sport') as Sport | null;
  const level = sp.get('level') as Level | null;
  const date = sp.get('date');
  const useGeoloc = sp.get('useGeoloc') === '1';
  const distanceKm = sp.get('distanceKm');
  const lat = sp.get('lat');
  const lng = sp.get('lng');

  const [candidates, setCandidates] = useState<any[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  type QueuedDecision = { targetProfileId: string; decision: 'ACCEPT'|'REFUSE'; ts: number };
  const [decisionQueue, setDecisionQueue] = useState<QueuedDecision[]>([]);
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);
  const [animating, setAnimating] = useState(false);
  const toast = useToast();

  const current = candidates[cursor] || null;
  const [lastAction, setLastAction] = useState<null | { id: string; decision: 'ACCEPT'|'REFUSE'; profile: any; wasEndOfBatch: boolean; prevCursor: number; timeout: any }>(null);
  const [newMatch, setNewMatch] = useState<null | { conversationId: string; otherDisplayName: string; sport: 'surf'|'kitesurf' }>(null);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);

  const fetchBatch = async (merge = false) => {
    if (!sport || !level || !date) return;
    setLoading(true); setError(null);
    try {
      const seen = new Set(excludeIds);
      for (const c of candidates) seen.add(c.id);
      const body: any = { sport, level, date, page: 1, pageSize: 20, sortBy: 'distance', excludeIds: Array.from(seen) };
      if (useGeoloc && distanceKm) body.distanceKm = Number(distanceKm);
      if (useGeoloc && lat && lng) body.location = { lat: Number(lat), lng: Number(lng) };
      const data = await apiClient.searchMatching(body);
      const incoming: any[] = data.results || [];
      if (!merge) {
        setCandidates(incoming);
        setCursor(0);
      } else {
        const existingIds = new Set(candidates.map(c => c.id));
        const dedup = incoming.filter(x => !existingIds.has(x.id));
        setCandidates(prev => prev.concat(dedup));
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBatch(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sport, level, date, useGeoloc, distanceKm, lat, lng]);

  // Unread badge loader
  const loadUnread = async () => {
    try {
      const data = await apiClient.listConversations();
      const total = (data.items || []).reduce((acc: number, it: any) => acc + (Number(it.unread) || 0), 0);
      setUnreadTotal(total);
    } catch {}
  };
  useEffect(() => { loadUnread(); const t = setInterval(loadUnread, 15000); return () => clearInterval(t); }, []);

  const next = () => {
    const nextIndex = cursor + 1;
    if (nextIndex < candidates.length) {
      setCursor(nextIndex);
    } else {
      // add seen ids to exclude and fetch a new batch
      const seen = candidates.map((c) => c.id).slice(0, 200);
      const newEx = Array.from(new Set([...excludeIds, ...seen])).slice(-200);
      setExcludeIds(newEx);
      setCandidates([]);
      setCursor(0);
      fetchBatch();
    }
  };

  // Prefetch when reaching near end
  useEffect(() => {
    const remaining = candidates.length - cursor - 1;
    if (remaining <= 3 && candidates.length > 0 && !loading) {
      fetchBatch(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, candidates.length]);

  const act = async (decision: 'ACCEPT' | 'REFUSE') => {
    if (!current?.id) return;
    if (animating) return;
    setAnimating(true);
    setAnimDir(decision === 'REFUSE' ? 'left' : 'right');
    const wasEnd = cursor + 1 >= candidates.length;
    const prevCur = cursor;
    const profileCopy = current;
    setTimeout(() => {
      // Queue decision with timestamp (allows 5s undo before flush)
      setDecisionQueue((q) => [...q, { targetProfileId: profileCopy.id as string, decision, ts: Date.now() }]);
      // Exclude current and go next
      setExcludeIds((arr) => Array.from(new Set([...arr, profileCopy.id as string])).slice(-200));
      next();
      setAnimDir(null);
      setAnimating(false);
      // Start undo window (5s)
      const t = setTimeout(() => {
        setLastAction((la) => (la && la.id === profileCopy.id ? null : la));
      }, 5000);
      setLastAction({ id: profileCopy.id as string, decision, profile: profileCopy, wasEndOfBatch: wasEnd, prevCursor: prevCur, timeout: t });
    }, 220);
  };

  // Batch flush decisions every 2s and on tab hide; only send items older than 5s
  useEffect(() => {
    let t: any = null;
    const flush = async () => {
      if (decisionQueue.length === 0) return;
      const now = Date.now();
      const due = decisionQueue.filter((d) => now - d.ts >= 5000);
      if (due.length === 0) return;
      const pending = decisionQueue.filter((d) => now - d.ts < 5000);
      setDecisionQueue(pending);
      try {
        const resp = await apiClient.matchDecisions(due.map(({ targetProfileId, decision }) => ({ targetProfileId, decision })) as any);
        if (resp?.createdConversations && Array.isArray(resp.createdConversations) && resp.createdConversations.length > 0) {
          const m = resp.createdConversations[0];
          const s = (sport || 'surf') as 'surf'|'kitesurf';
          setNewMatch({ conversationId: m.conversationId, otherDisplayName: m.otherDisplayName || 'Profil', sport: s });
          // Refresh unread badge quickly
          loadUnread();
        }
      } catch {
        // If failed, requeue keeping original timestamps
        setDecisionQueue((q) => [...due, ...q]);
      }
    };
    t = setInterval(flush, 2000);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { if (t) clearInterval(t); document.removeEventListener('visibilitychange', onHide); };
  }, [decisionQueue]);

  const undo = () => {
    if (!lastAction) return;
    try { clearTimeout(lastAction.timeout); } catch {}
    // Remove from queue if still pending
    setDecisionQueue((q) => q.filter((d) => d.targetProfileId !== lastAction.id));
    // Remove from excludes
    setExcludeIds((arr) => arr.filter((id) => id !== lastAction.id));
    // Restore position/profile
    if (lastAction.wasEndOfBatch) {
      setCandidates((prev) => [lastAction.profile, ...prev]);
      setCursor(0);
    } else {
      setCursor(lastAction.prevCursor);
    }
    setLastAction(null);
  };

  const report = async () => {
    if (!current?.id) return;
    const reason = prompt('Motif du signalement (optionnel) :') || undefined;
    try {
      await apiClient.reportProfile({ targetProfileId: current.id, reason });
      toast('Signalement envoyé. Merci pour votre aide.', 'success');
    } catch (e: any) {
      toast(e?.message || 'Erreur lors du signalement', 'error');
    }
  };

  const header = useMemo(() => {
    const geoPart = useGeoloc ? (distanceKm ? `${distanceKm} km` : '—') : 'sans géolocalisation';
    return `${sport || '—'} > ${level || '—'} > ${geoPart} > ${date || '—'}`;
  }, [sport, level, useGeoloc, distanceKm, date]);

  const isInitialLoading = loading && candidates.length === 0;
  const isPrefetching = loading && candidates.length > 0;

  return (
    <div className="max-w-md mx-auto space-y-4">
      <BackBar fallbackHref="/matching/date" />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Profils</CardTitle>
            <Link href="/messages" className="text-xs underline text-primary">
              Messagerie {unreadTotal>0 && <span className="ml-1 inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5">{unreadTotal}</span>}
            </Link>
          </div>
          <CardDescription>{header}</CardDescription>
        </CardHeader>
        <CardContent className="relative">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {isInitialLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
          {!loading && !current && <p className="text-sm text-muted-foreground">Plus de profils pour le moment.</p>}
          {current && (
            <div className="space-y-3">
              <div className={
                'rounded-md border p-4 transform transition duration-200 will-change-transform ' +
                (animDir === 'left' ? '-translate-x-24 opacity-0' : animDir === 'right' ? 'translate-x-24 opacity-0' : '')
              }>
                <div className="text-base font-medium flex items-center gap-2">
                  {current.displayName}
                  {current.wantsLesson && (
                    <span title="Souhaite un cours" className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px]">
                      🎓 Cours
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground">{current.gender === 'FEMALE' ? 'Femme' : 'Homme'} • {current.sport} • {current.level}</div>
                <div className="text-sm text-muted-foreground">{current.distanceKm != null ? `${current.distanceKm} km` : 'distance inconnue'}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={report} disabled={animating} aria-disabled={animating}>Signaler</Button>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="secondary" onClick={() => act('REFUSE')} disabled={animating} aria-disabled={animating}>Refuser</Button>
                  <Button onClick={() => act('ACCEPT')} disabled={animating} aria-disabled={animating}>Accepter</Button>
                </div>
              </div>
              {lastAction && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div>
                    Action: {lastAction.decision === 'ACCEPT' ? 'Accepté' : 'Refusé'} — annuler dans 5 s
                  </div>
                  <Button variant="outline" size="sm" onClick={undo}>Annuler</Button>
                </div>
              )}
            </div>
          )}
          {isPrefetching && (
            <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner /> Préchargement…
            </div>
          )}
        </CardContent>
      </Card>
      {newMatch && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4" onClick={() => setNewMatch(null)}>
          <div className="w-full max-w-sm rounded-lg bg-background border shadow-lg" onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 space-y-2">
              <div className="text-xl font-semibold">{newMatch.sport === 'surf' ? 'Go surf ?' : 'Go kite ?'}</div>
              <div className="text-sm text-muted-foreground">avec {newMatch.otherDisplayName}</div>
              <div className="pt-2 flex items-center gap-2">
                <Button onClick={() => { const cid = newMatch.conversationId; setNewMatch(null); router.push(`/messages/${cid}`); }}>Dire bonjour</Button>
                <Button variant="outline" onClick={() => setNewMatch(null)}>Plus tard</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto">Chargement…</div>}>
      <CardsInner />
    </Suspense>
  );
}
