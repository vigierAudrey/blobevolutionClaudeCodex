"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { BackBar } from '../../../components/BackBar';
import { ProfileCardSkeleton } from '../../../components/ui/skeleton';
import { optimizedApiClient, measureApiPerformance } from '../../../lib/optimizedApiClient';
import { useToast } from '../../../components/ui/toast';
import Link from 'next/link';
import { CalendarDays, Flag, MapPin, MessageSquare } from 'lucide-react';
import { formatDateForDisplay } from './utils';
import type { MatchingCandidate, MatchingSearchParams, MatchingSearchResponse, Sport, Level } from '@/types';
import { clearMatchingStorage } from '../storage';
import { FRANCE_ONLY_INFO_MESSAGE } from '../../../lib/franceLaunch';
import { ProfilePhoto } from '../../../components/media/ProfilePhoto';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobEmptyState, BlobPageHeader } from '@/components/blob';


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

const MATCHING_LOAD_ERROR = 'Impossible de charger les profils pour le moment.';
const MATCHING_DECISION_ERROR = 'Impossible d’enregistrer cette décision pour le moment.';
const MATCHING_REPORT_ERROR = 'Impossible d’envoyer le signalement pour le moment.';

const isFranceOnlyError = (error: unknown) =>
  error instanceof Error &&
  error.message.toLocaleLowerCase('fr').includes('limité à la france métropolitaine et à la corse');

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

        // Use optimized parallel initialization
        const { user, profile, disciplines } = await optimizedApiClient.initializeUser();

        if (user.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }

        // Vérifier si le profil est complet avant d'accéder au matching
        const hasName = !!profile?.displayName;
        const hasPhoto = Boolean(profile?.hasPhoto);
        const hasDiscipline = Array.isArray(disciplines) && disciplines.length > 0;
        const incomplete = !hasName || !hasPhoto || !hasDiscipline;

        if (incomplete) {
          router.replace('/onboarding');
          return;
        }

        perf.end();
      } catch {
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
      setError(isFranceOnlyError(err) ? FRANCE_ONLY_INFO_MESSAGE : MATCHING_LOAD_ERROR);
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
          let acceptedDisplayName: string | null = null;
          for (const id of acceptedIds) {
            const profile = acceptedProfilesRef.current.get(id);
            if (profile) {
              photoUrl = profile.photoUrl;
              acceptedDisplayName = profile.displayName;
              break;
            }
          }
          setNewMatch({
            conversationId: convo.conversationId,
            // L'API ne renvoie que conversationId : le nom vient du profil
            // accepté (déjà mémorisé pour la photo).
            otherDisplayName: convo.otherDisplayName ?? acceptedDisplayName ?? 'Rider',
            sport: activeSport,
            photoUrl
          });
        }
      }
      mutateDecisionQueue((prev) => prev.filter((entry) => !queue.includes(entry)));
    } catch {
      toast(MATCHING_DECISION_ERROR, 'error');
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
      activeTimeoutsRef.current.delete(timeout);
      setAnimating(false);
      setAnimDir(null);
      setCandidates((prev) => prev.slice(1));
      setCursor((prev) => Math.min(prev, candidatesRef.current.length - 2));
      setExcludeIds((prev) => prev.concat(targetProfileId));
      if (decisionQueueRef.current.length > 5) {
        void flushDecisions();
      }
    }, 200);
    activeTimeoutsRef.current.add(timeout);

    const newDecision = { targetProfileId, decision, ts: Date.now() };
    mutateDecisionQueue((queue) => queue.concat(newDecision));
    setLastAction({
      id: targetProfileId,
      decision,
      profile: current!,
      wasEndOfBatch: candidates.length <= 1,
      prevCursor: cursor,
      timeout
    });
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

  // ✅ Track all active timeouts for cleanup on unmount
  const activeTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const activeTimeouts = activeTimeoutsRef.current;
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
      // ✅ Cleanup all pending animation timeouts on unmount
      activeTimeouts.forEach(timeout => clearTimeout(timeout));
      activeTimeouts.clear();
    };
  }, [flushDecisions]);

  useEffect(() => {
    return () => {
      void flushDecisions(true);
    };
  }, [flushDecisions]);

  useEffect(() => {
    if (!lastAction) return;
    const autoHide = setTimeout(() => setLastAction(null), 5000);
    return () => {
      clearTimeout(autoHide);
      // ✅ Cleanup pending animation timeout to prevent Jest worker leak
      if (lastAction.timeout) {
        clearTimeout(lastAction.timeout);
      }
    };
  }, [lastAction]);

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
      setCandidates((prev) => {
        const updated = [...prev];
        updated.splice(lastAction.prevCursor, 0, lastAction.profile);
        return updated;
      });
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
    } catch {
      toast(MATCHING_REPORT_ERROR, 'error');
    }
  };

  const isInitialLoading = loading && candidates.length === 0;
  const isPrefetching = loading && candidates.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <BackBar fallbackHref="/matching/date" tone="blobDark" />

      <div className="space-y-4">
        <BlobBadge variant="yellow" size="md">Étape 3/3</BlobBadge>
        <BlobPageHeader
          title="Parcourir les profils"
          subtitle={`${sport ? sportLabels[sport] : '—'} · ${level ? levelLabels[level] : '—'} · ${useGeoloc ? `${distanceKm ?? 20} km` : 'Sans géoloc'} · ${date === 'anytime' ? 'Peu importe' : date || '—'}`}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <BlobButton
            variant="outlineDark"
            size="sm"
            onClick={handleResetCriteria}
            className="w-full sm:w-auto"
          >
            Repartir à zéro
          </BlobButton>
          <BlobButton asChild size="sm" variant="dark" className="w-full sm:w-auto">
            <Link href="/messages" className="inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Messages{unreadTotal > 0 ? ` (${unreadTotal})` : ''}
            </Link>
          </BlobButton>
        </div>
        {useGeoloc && (
          <BlobAlert variant="warning" title="Zone de lancement">
            {FRANCE_ONLY_INFO_MESSAGE}
          </BlobAlert>
        )}
      </div>

        <BlobCard mode="white" className="motion-safe:hover:translate-y-0">
            <div className="space-y-5">
              <header className="flex flex-col gap-3 border-b-2 border-blob-sand-deep pb-5 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-black uppercase tracking-widest">Profils proposés</h2>
                <BlobBadge variant="sand">Swipe ← ou →</BlobBadge>
              </header>
            <div className="relative space-y-4">
              {error && (
                <BlobAlert variant="error" title="Recherche indisponible">
                  {error}
                </BlobAlert>
              )}
              {isInitialLoading && (
                <div className="space-y-4" aria-live="polite" aria-busy="true">
                  <ProfileCardSkeleton />
                  <p className="text-center text-sm font-black uppercase tracking-widest text-blob-black/64 dark:text-white/64">
                    Recherche de profils compatibles…
                  </p>
                </div>
              )}
              {!loading && !current && (
                <BlobEmptyState
                  title="Plus de profils disponibles"
                  description="Pas de match immédiat. Relance une recherche avec un rayon plus large ou repasse un peu plus tard."
                  action={(
                    <div className="flex w-full flex-col gap-3 sm:flex-row">
                      <BlobButton onClick={() => router.push('/dashboard')} size="sm" className="w-full">
                        Retour au dashboard
                      </BlobButton>
                      <BlobButton variant="outlineDark" onClick={() => router.push('/matching')} size="sm" className="w-full">
                        Nouvelle recherche
                      </BlobButton>
                    </div>
                  )}
                />
              )}
              {current && (
                <div className="space-y-4">
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
                      'relative cursor-grab select-none overflow-hidden rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4 active:cursor-grabbing dark:border-white/15 dark:bg-white/5 sm:p-6 ' +
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
                      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-green-500/20"
                      style={{ opacity: opacityAccept }}
                    >
                      <div className="text-3xl font-black text-green-800 dark:text-green-200">✓</div>
                    </motion.div>
                    <motion.div
                      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-red-500/20"
                      style={{ opacity: opacityRefuse }}
                    >
                      <div className="text-3xl font-black text-red-800 dark:text-red-200">✗</div>
                    </motion.div>

                    <div className="relative z-10 mb-4 flex flex-col items-center gap-4">
                      {current.photoUrl ? (
                        <ProfilePhoto
                          src={current.photoUrl}
                          alt={current.displayName ?? 'Photo de profil'}
                          width={320}
                          height={320}
                          className="h-56 w-56 rounded-sm border-4 border-white object-cover shadow-lg sm:h-72 sm:w-72 lg:h-80 lg:w-80"
                          fallbackClassName="flex h-56 w-56 items-center justify-center rounded-sm border-4 border-white bg-white px-4 text-center text-sm text-blob-black/60 shadow-lg sm:h-72 sm:w-72 lg:h-80 lg:w-80"
                          priority
                        />
                      ) : (
                        <div className="flex h-56 w-56 items-center justify-center rounded-sm border-4 border-white bg-white text-6xl text-blob-black shadow-lg sm:h-72 sm:w-72 lg:h-80 lg:w-80" aria-label="Photo de profil indisponible">
                          <span aria-hidden="true">👤</span>
                        </div>
                      )}

                      <div className="w-full space-y-2 text-center">
                        <div className="flex flex-wrap items-center justify-center gap-2 text-2xl font-black uppercase tracking-widest">
                          {current.displayName}
                          {current.wantsLesson && (
                            <BlobBadge variant="success">
                              🎓 Cours
                            </BlobBadge>
                          )}
                        </div>
                        <div className="text-sm font-medium text-blob-black/70 dark:text-white/70 sm:text-base">
                          {/* UNSPECIFIED (« Ne pas préciser ») : le segment sexe est masqué */}
                          {current.gender === 'FEMALE' ? 'Femme • ' : current.gender === 'MALE' ? 'Homme • ' : current.gender === 'OTHER' ? 'Autre • ' : ''}{current.sport ? sportLabels[current.sport as Sport] : current.sport} • {current.level ? levelLabels[current.level as Level] : current.level}
                        </div>
                      </div>
                    </div>

                    {current.bio && (
                      <div className="relative z-10 mb-4 rounded-sm border-2 border-blob-sand-deep bg-white p-4 text-center text-base italic text-blob-black/72 dark:border-white/15 dark:bg-white/5 dark:text-white/72">
                        &laquo;&nbsp;{current.bio}&nbsp;&raquo;
                      </div>
                    )}

                    <div className="relative z-10 mb-2 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row sm:gap-6 sm:text-base">
                      <div className="flex items-center gap-2 text-blob-black/72 dark:text-white/72">
                        <MapPin className="h-5 w-5" aria-hidden="true" />
                        <span className="font-medium">{current.distanceKm != null ? `${current.distanceKm} km` : 'Distance inconnue'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-blob-black/72 dark:text-white/72">
                        <CalendarDays className="h-5 w-5" aria-hidden="true" />
                        <span className="font-medium">{formatDateForDisplay(date)}</span>
                      </div>
                    </div>
                  </motion.div>
                <p className="mb-2 text-center text-xs text-blob-black/60 dark:text-white/60">
                  Glisse vers la gauche pour refuser, vers la droite pour accepter.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <BlobButton variant="outlineDark" size="md" onClick={report} disabled={animating} aria-disabled={animating}>
                    <Flag className="h-4 w-4" aria-hidden="true" />
                    Signaler
                  </BlobButton>
                  <BlobButton variant="dark" size="md" onClick={() => act('REFUSE')} disabled={animating} aria-disabled={animating}>Refuser</BlobButton>
                  <BlobButton size="md" onClick={() => act('ACCEPT')} disabled={animating} aria-disabled={animating}>Accepter</BlobButton>
                  </div>
                {lastAction && (
                  <div className="flex flex-col gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 text-xs text-blob-black/70 dark:border-white/10 dark:bg-white/5 dark:text-white/70 sm:flex-row sm:items-center sm:justify-between">
                    <p>
                      Action: {lastAction.decision === 'ACCEPT' ? 'Accepté' : 'Refusé'} — annuler dans 5 s
                    </p>
                    <BlobButton variant="outlineDark" size="sm" onClick={undo}>Annuler</BlobButton>
                  </div>
                )}
              </div>
            )}
            {isPrefetching && (
              <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-sm border-2 border-blob-sand-deep bg-white/95 px-2 py-1 text-xs text-blob-black/70 shadow-sm backdrop-blur-sm dark:border-white/15 dark:bg-blob-black/95 dark:text-white/70" aria-live="polite">
                <div className="h-3 w-3 animate-pulse rounded-sm bg-blob-yellow" />
                Préchargement…
              </div>
            )}
            </div>
          </div>
        </BlobCard>
        {newMatch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-blob-black/75 px-4 backdrop-blur-sm" onClick={() => setNewMatch(null)}>
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.4 }}
              className="w-full max-w-md"
              onClick={(e)=>e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="match-dialog-title"
            >
              <div className="overflow-hidden rounded-sm border-4 border-blob-yellow bg-blob-yellow p-1 shadow-2xl">
                <div className="rounded-sm bg-white p-6 text-blob-black sm:p-8">
                  <div className="space-y-6 text-center">
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.1, type: "spring", bounce: 0.6 }}
                    >
                      <div className="mb-3 text-5xl" aria-hidden="true">🎉</div>
                      <h2 id="match-dialog-title" className="mb-2 text-3xl font-black uppercase tracking-widest sm:text-4xl">
                        C&rsquo;est un match !
                      </h2>
                    </motion.div>

                    <motion.div
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ delay: 0.2, type: "spring", bounce: 0.5 }}
                      className="flex justify-center"
                    >
                      <div>
                        {newMatch.photoUrl ? (
                          <ProfilePhoto
                            src={newMatch.photoUrl}
                            alt={newMatch.otherDisplayName}
                            width={160}
                            height={160}
                            className="h-36 w-36 rounded-sm border-4 border-blob-black object-cover shadow-lg sm:h-44 sm:w-44"
                            fallbackClassName="flex h-36 w-36 items-center justify-center rounded-sm border-4 border-blob-black bg-blob-sand px-4 text-center text-xs text-blob-black/60 shadow-lg sm:h-44 sm:w-44"
                          />
                        ) : (
                          <div className="flex h-36 w-36 items-center justify-center rounded-sm border-4 border-blob-black bg-blob-sand text-7xl shadow-lg sm:h-44 sm:w-44" aria-label="Photo de profil indisponible">
                            <span aria-hidden="true">👤</span>
                          </div>
                        )}
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="space-y-3"
                    >
                      <p className="flex items-center justify-center gap-2 text-lg font-medium sm:text-xl">
                        {newMatch.sport === 'surf' ? <span className="text-2xl" aria-hidden="true">🏄</span> : <span className="text-2xl" aria-hidden="true">🪁</span>}
                        <span>Tu vas {newMatch.sport === 'surf' ? 'surfer' : 'kiter'} avec</span>
                      </p>
                      <p className="text-2xl font-black uppercase tracking-widest sm:text-3xl">
                        {newMatch.otherDisplayName}
                      </p>
                      <div className="rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4 text-sm text-blob-black/72">
                        <MessageSquare className="mr-2 inline h-4 w-4" aria-hidden="true" />
                        <span className="font-medium">Envoie un premier message pour briser la glace !</span>
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="flex flex-col gap-3 pt-2 sm:flex-row"
                    >
                      <BlobButton
                        size="md"
                        className="w-full flex-1"
                        onClick={() => { const cid = newMatch.conversationId; setNewMatch(null); router.push(`/messages/${cid}`); }}
                      >
                        <MessageSquare className="h-4 w-4" aria-hidden="true" />
                        Envoyer un message
                      </BlobButton>
                      <BlobButton
                        size="md"
                        variant="outlineDark"
                        className="w-full sm:w-auto"
                        onClick={() => setNewMatch(null)}
                      >
                        Plus tard
                      </BlobButton>
                    </motion.div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
  );
}

export default CardsClient;
