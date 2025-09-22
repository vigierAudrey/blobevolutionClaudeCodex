"use client";
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { optimizedApiClient, measureApiPerformance } from '../../../lib/optimizedApiClient';
import { Spinner } from '../../../components/ui/spinner';
import { ProfileCardSkeleton, PageHeaderSkeleton } from '../../../components/ui/skeleton';
import { useInitializationSkeleton, useSearchSkeleton } from '../../../hooks/useSkeletonState';
import { useToast } from '../../../components/ui/toast';
import Link from 'next/link';

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';

function formatDateForDisplay(dateStr: string | null): string {
  if (!dateStr) return '—';
  if (dateStr === 'anytime') return 'Peu importe';

  const today = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const todayISO = today.toISOString().slice(0, 10);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  if (dateStr === todayISO) return "Aujourd'hui";
  if (dateStr === tomorrowISO) return 'Demain';

  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch {
    return dateStr;
  }
}

function CardsInner() {
  const sp = useSearchParams();
  const router = useRouter();

  // Optimized user initialization with parallel requests and caching
  useEffect(() => {
    (async () => {
      try {
        const perf = measureApiPerformance('User Initialization');

        const tokens = optimizedApiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        // Use optimized parallel initialization
        const { user, profile, disciplines } = await optimizedApiClient.initializeUser();

        if (user.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }

        // Vérifier si le profil est complet avant d'accéder au matching
        const hasName = !!profile?.displayName;
        const hasPhoto = !!profile?.photoUrl;
        const hasDiscipline = Array.isArray(disciplines) && disciplines.length > 0;
        const incomplete = !hasName || !hasPhoto || !hasDiscipline;

        if (incomplete) {
          router.replace('/onboarding');
          return;
        }

        perf.end();
      } catch (error) {
        console.error('User initialization failed:', error);
        router.replace('/login');
      }
    })();
  }, [router]);
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

  // Motion values for swipe gestures
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-20, 20]);
  const opacity = useTransform(x, [-200, -50, 0, 50, 200], [0.5, 1, 1, 1, 0.5]);
  const scale = useTransform(x, [-200, 0, 200], [0.95, 1, 0.95]);

  const current = candidates[cursor] || null;
  const [lastAction, setLastAction] = useState<null | { id: string; decision: 'ACCEPT'|'REFUSE'; profile: any; wasEndOfBatch: boolean; prevCursor: number; timeout: any }>(null);
  const [newMatch, setNewMatch] = useState<null | { conversationId: string; otherDisplayName: string; sport: 'surf'|'kitesurf' }>(null);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Enhanced skeleton states
  const initSkeleton = useInitializationSkeleton();
  const searchSkeleton = useSearchSkeleton();

  const fetchBatch = async (merge = false) => {
    if (!sport || !level || !date) return;
    setLoading(true); setError(null);
    try {
      const seen = new Set(excludeIds);
      for (const c of candidates) seen.add(c.id);

      // Use cursor-based pagination (preferred) or fallback to legacy
      const body: any = {
        sport,
        level,
        date,
        sortBy: 'distance',
        excludeIds: Array.from(seen),
        limit: 50  // Use cursor-based pagination
      };

      // Include cursor for loading more (but not for initial load)
      if (merge && nextCursor) {
        body.cursor = nextCursor;
      }

      if (useGeoloc && distanceKm) body.distanceKm = Number(distanceKm);
      if (useGeoloc && lat && lng) body.location = { lat: Number(lat), lng: Number(lng) };

      const data = await optimizedApiClient.searchMatching(body);

      // Predictive prefetching for better UX
      if (!merge && data.results?.length > 0) {
        optimizedApiClient.prefetchMatchingData(body);
      }
      const incoming: any[] = data.results || [];

      // Update cursor and hasMore state
      setNextCursor(data.nextCursor || null);
      setHasMore(data.hasMore || false);

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

  // Optimized unread badge loader with caching
  const loadUnread = async () => {
    try {
      const data = await optimizedApiClient.listConversations();
      const total = (data.items || []).reduce((acc: number, it: any) => acc + (Number(it.unread) || 0), 0);
      setUnreadTotal(total);
    } catch {}
  };
  useEffect(() => {
    loadUnread();
    const t = setInterval(loadUnread, 15000);
    return () => clearInterval(t);
  }, []);

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

  // Prefetch when reaching near end - cursor-based infinite scroll
  useEffect(() => {
    const remaining = candidates.length - cursor - 1;
    if (remaining <= 10 && candidates.length > 0 && !loading && hasMore && nextCursor) {
      fetchBatch(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, candidates.length, hasMore, nextCursor]);

  // Haptic feedback helper
  const triggerHapticFeedback = () => {
    if ('vibrate' in navigator) {
      navigator.vibrate(50); // Light vibration for 50ms
    }
  };

  // Handle swipe gesture end
  const handleDragEnd = (event: any, info: PanInfo) => {
    const threshold = 100; // pixels needed to trigger action
    const velocity = info.velocity.x;
    const offset = info.offset.x;

    // Reset card position
    x.set(0);

    // Determine action based on swipe distance and velocity
    if (Math.abs(offset) > threshold || Math.abs(velocity) > 500) {
      triggerHapticFeedback(); // Provide tactile feedback
      if (offset > 0 || velocity > 500) {
        // Swipe right = Accept
        act('ACCEPT');
      } else {
        // Swipe left = Refuse
        act('REFUSE');
      }
    }
  };

  // Handle drag progress for real-time feedback
  const handleDrag = (event: any, info: PanInfo) => {
    const threshold = 100;
    const offset = info.offset.x;

    // Trigger light haptic when crossing threshold (only once per drag)
    if (Math.abs(offset) > threshold && !animating) {
      triggerHapticFeedback();
    }
  };

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
        const resp = await optimizedApiClient.matchDecisions(due.map(({ targetProfileId, decision }) => ({ targetProfileId, decision })) as any);
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
      await optimizedApiClient.reportProfile({ targetProfileId: current.id, reason });
      toast('Signalement envoyé. Merci pour votre aide.', 'success');
    } catch (e: any) {
      toast(e?.message || 'Erreur lors du signalement', 'error');
    }
  };

  const header = useMemo(() => {
    const geoPart = useGeoloc ? (distanceKm ? `${distanceKm} km` : '—') : 'sans géolocalisation';
    const datePart = date === 'anytime' ? 'peu importe' : date || '—';
    return `${sport || '—'} > ${level || '—'} > ${geoPart} > ${datePart}`;
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
          {isInitialLoading && (
            <div className="space-y-4">
              <ProfileCardSkeleton />
              <div className="text-center text-sm text-muted-foreground">
                🔍 Recherche de profils compatibles...
              </div>
            </div>
          )}
          {!loading && !current && (
            <div className="text-center space-y-4 py-6">
              <div className="space-y-2">
                <div className="text-4xl">🏄‍♀️</div>
                <h3 className="font-semibold text-lg">Plus de profils disponibles</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Désolé si tu n'as pas trouvé de partenaire pour partager ta session ! On reste optimiste,
                  la communauté des riders grandit chaque jour.
                </p>
                <p className="text-xs text-muted-foreground">
                  💡 Astuce : essaie d'augmenter ton périmètre de recherche pour découvrir plus de riders
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={() => router.push('/dashboard')} className="w-full">
                  Retour au dashboard
                </Button>
                <Button variant="outline" onClick={() => router.push('/matching')} className="w-full">
                  Nouvelle recherche
                </Button>
              </div>
            </div>
          )}
          {current && (
            <div className="space-y-3">
              <motion.div
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                dragMomentum={false}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
                style={{
                  x,
                  rotate,
                  opacity,
                  scale,
                  touchAction: 'pan-y', // Allow vertical scroll, handle horizontal
                  willChange: 'transform', // GPU acceleration hint
                }}
                className={
                  'rounded-md border p-4 cursor-grab active:cursor-grabbing select-none relative overflow-hidden ' +
                  (animDir === 'left' ? '-translate-x-24 opacity-0' : animDir === 'right' ? 'translate-x-24 opacity-0' : '')
                }
                whileTap={{ scale: 0.98 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                  mass: 0.5 // Lighter feel for mobile
                }}
              >
                {/* Swipe indicators */}
                <motion.div
                  className="absolute inset-0 bg-green-500/20 flex items-center justify-center pointer-events-none"
                  style={{ opacity: useTransform(x, [0, 100], [0, 1]) }}
                >
                  <div className="text-3xl text-green-600 font-bold">✓</div>
                </motion.div>
                <motion.div
                  className="absolute inset-0 bg-red-500/20 flex items-center justify-center pointer-events-none"
                  style={{ opacity: useTransform(x, [-100, 0], [1, 0]) }}
                >
                  <div className="text-3xl text-red-600 font-bold">✗</div>
                </motion.div>

                <div className="text-base font-medium flex items-center gap-2 relative z-10">
                  {current.displayName}
                  {current.wantsLesson && (
                    <span title="Souhaite un cours" className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px]">
                      🎓 Cours
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground relative z-10">{current.gender === 'FEMALE' ? 'Femme' : 'Homme'} • {current.sport} • {current.level}</div>
                <div className="text-sm text-muted-foreground relative z-10">{current.distanceKm != null ? `${current.distanceKm} km` : 'distance inconnue'}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-1 relative z-10">
                  <span>📅</span>
                  <span>{formatDateForDisplay(date)}</span>
                </div>
              </motion.div>
              <div className="text-xs text-center text-muted-foreground mb-2">
                👈 Glisse vers la gauche pour refuser • Glisse vers la droite pour accepter 👉
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
            <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-muted-foreground bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full border shadow-sm">
              <div className="w-3 h-3 rounded-full bg-primary/20 animate-pulse" />
              ⚡ Préchargement...
            </div>
          )}
        </CardContent>
      </Card>
      {newMatch && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4" onClick={() => setNewMatch(null)}>
          <div className="w-full max-w-sm rounded-lg bg-background border shadow-lg" onClick={(e)=>e.stopPropagation()}>
            <div className="p-6 space-y-4 text-center">
              <div className="text-2xl">🎉</div>
              <div className="text-xl font-semibold">C'est un match !</div>
              <div className="text-base">
                {newMatch.sport === 'surf' ? 'Tu vas pouvoir surfer' : 'Tu vas pouvoir kiter'} avec <span className="font-semibold text-primary">{newMatch.otherDisplayName}</span>
              </div>
              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                💬 Envoie un message cool pour commencer la conversation !
              </div>
              <div className="pt-2 flex flex-col gap-2">
                <Button className="w-full" onClick={() => { const cid = newMatch.conversationId; setNewMatch(null); router.push(`/messages/${cid}`); }}>
                  Envoyer un message 🚀
                </Button>
                <Button variant="outline" className="w-full" onClick={() => setNewMatch(null)}>Plus tard</Button>
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
