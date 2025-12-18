"use client";
import dynamicImport from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { ProfileCardSkeleton } from '../../../components/ui/skeleton';
import { optimizedApiClient, measureApiPerformance } from '../../../lib/optimizedApiClient';
import { useToast } from '../../../components/ui/toast';
import Link from 'next/link';
import { Sparkles, MessageSquare } from 'lucide-react';
import { formatDateForDisplay } from './utils';
import type { MatchingCandidate, MatchingSearchParams, MatchingSearchResponse, Sport, Level } from '@/types';
import { clearMatchingStorage } from '../storage';

const AdBannerFeed = dynamicImport(
  () => import('../../../components/ads/AdBanner').then((mod) => mod.AdBannerFeed),
  {
    ssr: false,
    loading: () => <div className="my-6 h-24 rounded-md bg-slate-200/60" aria-hidden="true" />,
  },
);

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

type ConversationsResponse = {
  items?: Array<{ unread?: number | string }>;
};

type MatchDecisionResponse = {
  createdConversations?: Array<{ conversationId: string; otherDisplayName?: string | null }>;
};

export function CardsClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const handleResetCriteria = useCallback(() => {
    clearMatchingStorage();
    router.push('/matching');
  }, [router]);

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
  const [newMatch, setNewMatch] = useState<null | { conversationId: string; otherDisplayName: string; sport: 'surf'|'kitesurf'; photoUrl?: string | null }>(null);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const candidatesRef = useRef<MatchingCandidate[]>([]);
  const excludeIdsRef = useRef<string[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const decisionQueueRef = useRef<QueuedDecision[]>([]);
  const acceptedProfilesRef = useRef<Map<string, { displayName: string; photoUrl?: string | null }>>(new Map());

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
          // Récupérer la photo du profil accepté depuis la map
          const acceptedIds = queue.filter(q => q.decision === 'ACCEPT').map(q => q.targetProfileId);
          let photoUrl: string | null | undefined = null;
          for (const id of acceptedIds) {
            const profile = acceptedProfilesRef.current.get(id);
            if (profile) {
              photoUrl = profile.photoUrl;
              break;
            }
          }
          setNewMatch({
            conversationId: convo.conversationId,
            otherDisplayName: convo.otherDisplayName ?? 'Rider',
            sport: activeSport,
            photoUrl
          });
        }
      }
      mutateDecisionQueue((prev) => prev.filter((entry) => !queue.includes(entry)));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast(message || 'Erreur lors de la décision', 'error');
    }
  }, [activeSport, mutateDecisionQueue, toast]);

  const handleSwipe = useCallback((decision: 'ACCEPT' | 'REFUSE') => {
    const targetProfileId = current?.id;
    if (!targetProfileId) return;

    // Stocker les infos du profil accepté pour la modale de match
    if (decision === 'ACCEPT' && current) {
      acceptedProfilesRef.current.set(targetProfileId, {
        displayName: current.displayName ?? 'Rider',
        photoUrl: current.photoUrl
      });
    }

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
  }, [current, candidates, cursor, mutateDecisionQueue, flushDecisions]);

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

  const isInitialLoading = loading && candidates.length === 0;
  const isPrefetching = loading && candidates.length > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10 px-4 sm:px-6 lg:px-0">
      <BackBar fallbackHref="/matching/date" />

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20 p-4 border-2 border-purple-200/50 dark:border-purple-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Deck Matching</h1>
              <p className="text-sm text-muted-foreground">
                {sport ? sportLabels[sport] : '—'} · {level ? levelLabels[level] : '—'} · {useGeoloc ? `${distanceKm ?? 20} km` : 'Sans géoloc'} · {date === 'anytime' ? 'Peu importe' : date || '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetCriteria}
              className="border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-200"
            >
              Repartir à zéro
            </Button>
            <Button asChild size="sm" variant="secondary" className="bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 hover:bg-white/90 dark:hover:bg-slate-700">
              <Link href="/messages" className="inline-flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                {unreadTotal > 0 ? `${unreadTotal}` : ''}
              </Link>
            </Button>
          </div>
        </div>

        <Card className="border-2 shadow-xl rounded-[2rem]">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Profils proposés</CardTitle>
                <Badge variant="secondary" className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                  Swipe ← ou →
                </Badge>
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
                  <div className="space-y-3 rounded-3xl border-2 border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 px-6 py-8">
                    <div className="text-4xl">🏄‍♀️</div>
                    <h3 className="font-semibold text-xl text-foreground">Plus de profils disponibles</h3>
                    <p className="text-sm text-muted-foreground dark:text-slate-400 max-w-sm mx-auto">
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
                      'rounded-[1.75rem] border-2 p-5 sm:p-6 lg:p-7 bg-gradient-to-br from-white via-white to-purple-50/50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 cursor-grab active:cursor-grabbing select-none relative overflow-hidden shadow-xl ' +
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

                    {/* Photo de profil - Affichage vertical centré */}
                    <div className="flex flex-col items-center gap-4 mb-4 relative z-10">
                      {current.photoUrl ? (
                        <Image
                          src={current.photoUrl}
                          alt={current.displayName ?? 'Photo de profil'}
                          width={320}
                          height={320}
                          className="w-64 h-64 sm:w-72 sm:h-72 lg:w-80 lg:h-80 rounded-[2rem] object-cover border-4 border-border shadow-2xl"
                          unoptimized
                          priority
                        />
                      ) : (
                        <div className="w-64 h-64 sm:w-72 sm:h-72 lg:w-80 lg:h-80 rounded-[2rem] bg-muted flex items-center justify-center border-4 border-border shadow-2xl text-6xl">
                          <span>👤</span>
                        </div>
                      )}

                      <div className="w-full text-center space-y-2">
                        <div className="text-2xl font-bold text-foreground flex items-center justify-center gap-2 flex-wrap">
                          {current.displayName}
                          {current.wantsLesson && (
                            <span title="Souhaite un cours" className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-3 py-1 text-xs font-medium">
                              🎓 Cours
                            </span>
                          )}
                        </div>
                        <div className="text-base text-muted-foreground dark:text-slate-300 font-medium">
                          {current.gender === 'FEMALE' ? 'Femme' : current.gender === 'MALE' ? 'Homme' : 'Autre'} • {current.sport ? sportLabels[current.sport as Sport] : current.sport} • {current.level ? levelLabels[current.level as Level] : current.level}
                        </div>
                      </div>
                    </div>

                    {/* Bio */}
                    {current.bio && (
                      <div className="text-base text-muted-foreground dark:text-slate-300 italic bg-white/80 dark:bg-slate-700/50 border border-muted/40 dark:border-slate-600 p-4 rounded-2xl mb-4 relative z-10 text-center">
                        &laquo;&nbsp;{current.bio}&nbsp;&raquo;
                      </div>
                    )}

                    {/* Infos complémentaires */}
                    <div className="flex items-center justify-center gap-6 mb-2 relative z-10">
                      <div className="text-base text-muted-foreground dark:text-slate-300 flex items-center gap-2">
                        <span className="text-xl">📍</span>
                        <span className="font-medium">{current.distanceKm != null ? `${current.distanceKm} km` : 'Distance inconnue'}</span>
                      </div>
                      <div className="text-base text-muted-foreground dark:text-slate-300 flex items-center gap-2">
                        <span className="text-xl">📅</span>
                        <span className="font-medium">{formatDateForDisplay(date)}</span>
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
              <div className="absolute right-3 bottom-3 flex items-center gap-2 text-xs text-muted-foreground dark:text-slate-300 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm px-2 py-1 rounded-full border dark:border-slate-700 shadow-sm">
                <div className="w-3 h-3 rounded-full bg-primary/20 animate-pulse" />
                ⚡ Préchargement...
              </div>
            )}
          </CardContent>
        </Card>
        {newMatch && (
          <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center px-4 animate-in fade-in duration-300" onClick={() => setNewMatch(null)}>
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.4 }}
              className="w-full max-w-md"
              onClick={(e)=>e.stopPropagation()}
            >
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-500 via-blue-500 to-sky-600 p-1 shadow-2xl">
                {/* Effet de brillance animé */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" style={{ backgroundSize: '200% 100%' }} />

                {/* Contenu de la modale */}
                <div className="relative rounded-[1.4rem] bg-white dark:bg-slate-900 p-6 sm:p-8">
                  <div className="space-y-6 text-center">
                    {/* Titre avec animation */}
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.1, type: "spring", bounce: 0.6 }}
                    >
                      <div className="text-5xl mb-3 animate-bounce">🎉</div>
                      <h2 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-cyan-600 via-blue-600 to-sky-600 bg-clip-text text-transparent mb-2">
                        C&rsquo;est un match !
                      </h2>
                    </motion.div>

                    {/* Photo de profil avec effet glow */}
                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ delay: 0.2, type: "spring", bounce: 0.5 }}
                      className="flex justify-center"
                    >
                      <div className="relative">
                        {/* Halo animé - couleurs océan */}
                        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500 via-blue-500 to-sky-500 rounded-full blur-2xl opacity-40 animate-pulse" style={{ transform: 'scale(1.3)' }} />

                        {newMatch.photoUrl ? (
                          <Image
                            src={newMatch.photoUrl}
                            alt={newMatch.otherDisplayName}
                            width={160}
                            height={160}
                            className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full object-cover border-4 border-white dark:border-slate-800 shadow-2xl"
                            unoptimized
                          />
                        ) : (
                          <div className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-7xl border-4 border-white dark:border-slate-800 shadow-2xl">
                            👤
                          </div>
                        )}
                      </div>
                    </motion.div>

                    {/* Message avec animation décalée */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="space-y-3"
                    >
                      <p className="text-lg sm:text-xl text-foreground font-medium flex items-center justify-center gap-2">
                        {newMatch.sport === 'surf' ? <span className="text-2xl">🏄</span> : <span className="text-2xl">🪁</span>}
                        <span>Tu vas {newMatch.sport === 'surf' ? 'surfer' : 'kiter'} avec</span>
                      </p>
                      <p className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                        {newMatch.otherDisplayName}
                      </p>
                      <div className="text-sm text-muted-foreground dark:text-slate-400 bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-900/20 dark:to-blue-900/20 border-2 border-cyan-200 dark:border-cyan-800 p-4 rounded-2xl">
                        💬 <span className="font-medium">Envoie un premier message pour briser la glace !</span>
                      </div>
                    </motion.div>

                    {/* Boutons responsive */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="pt-2 flex flex-col sm:flex-row gap-3"
                    >
                      <Button
                        size="lg"
                        className="flex-1 bg-gradient-to-r from-cyan-600 via-blue-600 to-sky-600 hover:from-cyan-700 hover:via-blue-700 hover:to-sky-700 text-white font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all"
                        onClick={() => { const cid = newMatch.conversationId; setNewMatch(null); router.push(`/messages/${cid}`); }}
                      >
                        💬 Envoyer un message
                      </Button>
                      <Button
                        size="lg"
                        variant="outline"
                        className="sm:flex-none border-2 border-cyan-300 dark:border-cyan-700 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 font-medium"
                        onClick={() => setNewMatch(null)}
                      >
                        Plus tard
                      </Button>
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CardsClient;
