"use client";
import dynamicImport from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { ProfileCardSkeleton } from '../../../components/ui/skeleton';
import { optimizedApiClient, measureApiPerformance } from '../../../lib/optimizedApiClient';
import { useToast } from '../../../components/ui/toast';
import Link from 'next/link';
import { Sparkles, MessageSquare } from 'lucide-react';
import { formatDateForDisplay } from './utils';
import type { MatchingCandidate, MatchingSearchParams, MatchingSearchResponse, Sport, Level } from '@/types';

const AdBannerFeed = dynamicImport(
  () => import('../../../components/ads/AdBanner').then((mod) => mod.AdBannerFeed),
  {
    ssr: false,
    loading: () => <div className="my-6 h-24 rounded-md bg-slate-200/60" aria-hidden="true" />,
  },
);

type ConversationsResponse = {
  items?: Array<{ unread?: number | string }>;
};

type MatchDecisionResponse = {
  createdConversations?: Array<{ conversationId: string; otherDisplayName?: string | null }>;
};

export function CardsClient() {
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
  const activeSport = (sport ?? 'surf') as 'surf' | 'kitesurf';
  const date = sp.get('date');
  const useGeoloc = sp.get('useGeoloc') === '1';
  const distanceKm = sp.get('distanceKm');
  const lat = sp.get('lat');
  const lng = sp.get('lng');

  const [candidates, setCandidates] = useState<MatchingCandidate[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  type QueuedDecision = { targetProfileId: string; decision: 'ACCEPT'|'REFUSE'; ts: number };
  const mutateDecisionQueue = useCallback((updater: (prev: QueuedDecision[]) => QueuedDecision[]) => {
    const nextQueue = updater(decisionQueueRef.current);
    decisionQueueRef.current = nextQueue;
  }, []);
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);
  const [animating, setAnimating] = useState(false);
  const toast = useToast();

  // Motion values for swipe gestures
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-20, 20]);
  const opacity = useTransform(x, [-200, -50, 0, 50, 200], [0.5, 1, 1, 1, 0.5]);
  const scale = useTransform(x, [-200, 0, 200], [0.95, 1, 0.95]);
  const opacityAccept = useTransform(x, [0, 100], [0, 1]);
  const opacityRefuse = useTransform(x, [-100, 0], [1, 0]);

  const current = candidates[cursor] || null;
  type LastAction = {
    id: string;
    decision: 'ACCEPT' | 'REFUSE';
    profile: MatchingCandidate;
    wasEndOfBatch: boolean;
    prevCursor: number;
    timeout: ReturnType<typeof setTimeout>;
  };
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [newMatch, setNewMatch] = useState<null | { conversationId: string; otherDisplayName: string; sport: 'surf'|'kitesurf' }>(null);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const candidatesRef = useRef<MatchingCandidate[]>([]);
  const excludeIdsRef = useRef<string[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const decisionQueueRef = useRef<QueuedDecision[]>([]);

  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);

  useEffect(() => {
    excludeIdsRef.current = excludeIds;
  }, [excludeIds]);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  // Enhanced skeleton states
  const fetchBatch = useCallback(async (merge = false) => {
    if (!sport || !level || !date) return;
    setLoading(true);
    setError(null);
    try {
      const seen = new Set(excludeIdsRef.current);
      candidatesRef.current.forEach((candidate) => seen.add(candidate.id));

      const body: MatchingSearchParams = {
        sport,
        level,
        date,
        sortBy: 'distance',
        excludeIds: Array.from(seen),
        limit: 50,
      };

      if (merge && nextCursorRef.current) {
        body.cursor = nextCursorRef.current;
      }

      if (useGeoloc && distanceKm) body.distanceKm = Number(distanceKm);
      if (useGeoloc && lat && lng) body.location = { lat: Number(lat), lng: Number(lng) };

      const data = await optimizedApiClient.searchMatching(body) as MatchingSearchResponse;

      if (!merge && data.results?.length) {
        optimizedApiClient.prefetchMatchingData(body);
      }

      const incoming: MatchingCandidate[] = data.results ?? [];
      setNextCursor(data.nextCursor ?? null);

      if (!merge) {
        setCandidates(incoming);
        setCursor(0);
      } else {
        const existingIds = new Set(candidatesRef.current.map((candidate) => candidate.id));
        const deduped = incoming.filter((candidate) => !existingIds.has(candidate.id));
        setCandidates((prev) => prev.concat(deduped));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      setError(message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, [sport, level, date, useGeoloc, distanceKm, lat, lng]);

  useEffect(() => {
    void fetchBatch();
  }, [fetchBatch]);

  // Optimized unread badge loader with caching
  const loadUnread = useCallback(async () => {
    try {
      const response = await optimizedApiClient.listConversations() as ConversationsResponse;
      const total = (response.items ?? []).reduce((acc, it) => acc + Number(it.unread ?? 0), 0);
      setUnreadTotal(total);
    } catch {}
  }, []);

  useEffect(() => {
    void loadUnread();
    const t = setInterval(loadUnread, Number(process.env.NEXT_PUBLIC_UNREAD_POLL_MS ?? '60000') || 60000);
    return () => clearInterval(t);
  }, [loadUnread]);

  const handleSwipe = useCallback((decision: 'ACCEPT' | 'REFUSE') => {
    const targetProfileId = current?.id;
    if (!targetProfileId) return;

    setAnimating(true);
    setAnimDir(decision === 'ACCEPT' ? 'right' : 'left');

    const timeout = setTimeout(() => {
      setAnimating(false);
      setAnimDir(null);
      setCandidates((prev) => prev.slice(1));
      setCursor((prev) => Math.min(prev, candidatesRef.current.length - 2));
      setExcludeIds((prev) => prev.concat(targetProfileId));
      if (decisionQueueRef.current.length > 5) {
        void flushDecisions();
      }
    }, 200);

    const newDecision = { targetProfileId, decision, ts: Date.now() };
    mutateDecisionQueue((queue) => queue.concat(newDecision));
    setLastAction({ id: targetProfileId, decision, profile: current!, wasEndOfBatch: candidates.length <= 1, prevCursor: cursor, timeout });
  }, [current, candidates, cursor, mutateDecisionQueue]);

  const act = (decision: 'ACCEPT' | 'REFUSE') => {
    handleSwipe(decision);
  };

  const handleDrag = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    x.set(info.offset.x);
  };

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x > 100) {
      act('ACCEPT');
    } else if (info.offset.x < -100) {
      act('REFUSE');
    } else {
      x.set(0);
    }
  };

  const flushDecisions = useCallback(async (force = false) => {
    if (!decisionQueueRef.current.length && !force) return;
    const queue = force ? decisionQueueRef.current : decisionQueueRef.current.slice(0, 5);
    if (!queue.length) return;
    const body = queue.map((entry) => ({ targetProfileId: entry.targetProfileId, decision: entry.decision }));
    try {
      const response = await optimizedApiClient.matchDecisions(body) as MatchDecisionResponse;
      if (response?.createdConversations?.length) {
        const convo = response.createdConversations[0];
        if (convo) {
          setNewMatch({ conversationId: convo.conversationId, otherDisplayName: convo.otherDisplayName ?? 'Rider', sport: activeSport });
        }
      }
      mutateDecisionQueue((prev) => prev.filter((entry) => !queue.includes(entry)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast(message || 'Erreur lors de la décision', 'error');
    }
  }, [activeSport, mutateDecisionQueue, toast]);

  useEffect(() => {
    const t = setInterval(() => {
      void flushDecisions();
    }, 1500);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushDecisions();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [flushDecisions]);

  useEffect(() => {
    return () => {
      void flushDecisions(true);
    };
  }, [flushDecisions]);

  const undo = () => {
    if (!lastAction) return;
    try { clearTimeout(lastAction.timeout); } catch {}
    // Remove from queue if still pending
    mutateDecisionQueue((q) => q.filter((d) => d.targetProfileId !== lastAction.id));
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast(message || 'Erreur lors du signalement', 'error');
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
    <div className="max-w-5xl mx-auto space-y-6 pb-10 px-4 sm:px-6 lg:px-0">
      <BackBar fallbackHref="/matching/date" />

      <div className="grid gap-6 items-start lg:grid-cols-[minmax(280px,0.95fr)_minmax(360px,1.25fr)]">
        <section className="relative overflow-hidden rounded-[2.2rem] bg-gradient-to-br from-rose-500 via-fuchsia-500 to-purple-500 p-6 sm:p-8 text-white shadow-2xl">
          <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_transparent_55%)]" aria-hidden />
          <div className="relative z-10 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
              <Sparkles className="w-3.5 h-3.5" />
              Deck Matching
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Swipe, matche, discute</h1>
              <p className="text-white/85 text-base max-w-2xl">
                Chaque swipe rapproche d’un binôme compatible. Tu peux basculer vers la liste détaillée si tu préfères comparer les fiches une par une.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1">
                {sport || '—'} · {level || '—'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1">
                {useGeoloc ? `${distanceKm ?? 20} km` : 'Sans géolocalisation'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1">
                {date === 'anytime' ? 'Peu importe' : date || '—'}
              </span>
            </div>
          </div>
        </section>

        <div className="w-full">
          <Card className="border-2 shadow-xl rounded-[2rem]">
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-pink-100 text-pink-700">
                      Étape finale
                    </Badge>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Swipe deck</span>
                  </div>
                  <CardTitle className="text-2xl">Profils proposés</CardTitle>
                </div>
                <Button asChild size="sm" variant="secondary" className="bg-white text-pink-600 hover:bg-white/90">
                  <Link href="/messages" className="inline-flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    {unreadTotal > 0 ? `${unreadTotal} msg` : 'Messagerie'}
                  </Link>
                </Button>
              </div>
              <CardDescription>Critères : {header}</CardDescription>
              <div className="rounded-2xl bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
                Swipe droite = match, gauche = passer. Boutons disponibles sous la carte.
              </div>
            </CardHeader>
            <CardContent className="relative space-y-4">
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
                <div className="text-center space-y-5 py-8">
                  <div className="space-y-3 rounded-3xl border bg-gradient-to-br from-purple-50 to-pink-50 px-6 py-8">
                    <div className="text-4xl">🏄‍♀️</div>
                    <h3 className="font-semibold text-xl">Plus de profils disponibles</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Pas de match immédiat, mais la communauté grandit chaque jour. Relance une recherche avec un rayon plus large ou repasse un peu plus tard.
                    </p>
                  </div>

                  <AdBannerFeed
                    slot="matching-end-feed"
                    className="max-w-sm mx-auto"
                  />

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
                      'rounded-[1.75rem] border-2 p-5 sm:p-6 lg:p-7 bg-gradient-to-br from-white via-white to-purple-50/50 cursor-grab active:cursor-grabbing select-none relative overflow-hidden shadow-xl ' +
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
                      style={{ opacity: opacityAccept }}
                    >
                      <div className="text-3xl text-green-600 font-bold">✓</div>
                    </motion.div>
                    <motion.div
                      className="absolute inset-0 bg-red-500/20 flex items-center justify-center pointer-events-none"
                      style={{ opacity: opacityRefuse }}
                    >
                      <div className="text-3xl text-red-600 font-bold">✗</div>
                    </motion.div>

                    {/* Photo de profil */}
                    <div className="flex flex-col sm:flex-row sm:items-start gap-5 mb-4 relative z-10">
                      {current.photoUrl ? (
                        <Image
                          src={current.photoUrl}
                          alt={current.displayName ?? 'Photo de profil'}
                          width={160}
                          height={160}
                          className="w-28 h-28 sm:w-32 sm:h-32 lg:w-36 lg:h-36 rounded-[1.8rem] object-cover border-2 border-border shadow-lg flex-shrink-0"
                          unoptimized
                        />
                      ) : (
                        <div className="w-28 h-28 sm:w-32 sm:h-32 lg:w-36 lg:h-36 rounded-[1.8rem] bg-muted flex items-center justify-center border-2 border-border flex-shrink-0 text-4xl shadow-inner">
                          <span>👤</span>
                        </div>
                      )}

                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="text-lg font-semibold flex items-center gap-2 flex-wrap">
                          {current.displayName}
                          {current.wantsLesson && (
                            <span title="Souhaite un cours" className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px]">
                              🎓 Cours
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {current.gender === 'FEMALE' ? 'Femme' : current.gender === 'MALE' ? 'Homme' : 'Autre'} • {current.sport} • {current.level}
                        </div>
                      </div>
                    </div>

                    {/* Bio */}
                    {current.bio && (
                      <div className="text-base text-muted-foreground italic bg-white/80 border border-muted/40 p-4 rounded-2xl mb-3 relative z-10">
                        &laquo;&nbsp;{current.bio}&nbsp;&raquo;
                      </div>
                    )}

                    {/* Infos complémentaires */}
                    <div className="space-y-2 relative z-10">
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <span className="text-lg">📍</span>
                        <span>{current.distanceKm != null ? `À ${current.distanceKm} km` : 'Distance inconnue'}</span>
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-1">
                        <span>📅</span>
                        <span>{formatDateForDisplay(date)}</span>
                      </div>
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
                <div className="text-xl font-semibold">C&rsquo;est un match !</div>
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
    </div>
  </div>
  );
}

export default CardsClient;
