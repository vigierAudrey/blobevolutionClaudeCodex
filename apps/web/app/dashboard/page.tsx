"use client";
import { BookOpen, GraduationCap, Info, LogOut, Map, MessageSquare, RadioTower, User } from 'lucide-react';
import { NotificationBell } from '../../components/NotificationBell';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobDashboardShell, BlobMark } from '@/components/blob';
import { apiClient } from '../../lib/apiClient';
import { requireClientSession, SessionRequiredError } from '../../lib/clientSession';

import { CommunityHighlight } from '../../components/community/CommunityHighlight';

// Force SSR due to auth context and dynamic user data
export const dynamic = 'force-dynamic';

const MATCHING_STORAGE_KEYS = {
  sport: 'matching.sport',
  level: 'matching.level',
  date: 'matching.date',
  distance: 'matching.distanceKm',
  useGeoloc: 'matching.useGeoloc',
  lat: 'matching.lat',
  lng: 'matching.lng',
} as const;

type DashboardUser = {
  id: string;
  email: string;
  role: 'RIDER' | 'PRO' | 'ADMIN';
  emailVerified: boolean;
  [key: string]: unknown;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);
  const [displayName, setDisplayName] = useState<string>('');
  const [matchingHref, setMatchingHref] = useState('/matching');
  const [hasMatchingShortcut, setHasMatchingShortcut] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const u = await requireClientSession();
        if (!active) return;

        const typedUser = u as DashboardUser;

        // Redirect non-RIDER users before any dashboard content renders.
        // active=false keeps the loader visible until navigation completes.
        if (typedUser.role === 'PRO') {
          router.replace('/pro/dashboard');
          active = false;
          return;
        }
        if (typedUser.role === 'ADMIN') {
          router.replace('/admin/dashboard');
          active = false;
          return;
        }

        // Profile completeness check runs before setLoading(false) so the
        // dashboard never renders and then redirects — it redirects silently.
        try {
          const [p, d] = await Promise.all([
            apiClient.getProfile(),
            apiClient.getDisciplines().catch(() => []),
          ]);
          if (!active) return;

          const hasName = !!p?.displayName;
          const hasPhoto = Boolean((p as { hasPhoto?: boolean } | null)?.hasPhoto);
          const hasDiscipline = Array.isArray(d) && d.length > 0;

          if (!hasName || !hasPhoto || !hasDiscipline) {
            router.replace('/onboarding');
            active = false;
            return;
          }

          if (p?.displayName) setDisplayName(p.displayName);
        } catch {
          // Profile check failed — show dashboard, degrade gracefully
        }

        setUser(typedUser);
        // First-login banner: show once per user until dismissed
        const key = `visited-dashboard-${typedUser.id}`;
        const visited = typeof window !== 'undefined' ? localStorage.getItem(key) : '1';
        if (!visited) setShowProfilePrompt(true);
        if (typeof window !== 'undefined') localStorage.setItem(key, '1');
      } catch (err) {
        if (!active) return;
        if (err instanceof SessionRequiredError) {
          router.replace('/login');
          active = false;
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  // Load aggregated unread count for conversations
  useEffect(() => {
    let active = true;
    let intervalId: number | undefined;
    const pollIntervalMs = Number(process.env.NEXT_PUBLIC_UNREAD_POLL_MS ?? '60000') || 60000;

    const loadUnread = async () => {
      try {
        const data = await apiClient.listAllConversations();
        if (!active) return;
        const response = data as { items?: Array<{ unread?: number }> };
        const total = (response.items ?? []).reduce((acc, it) => acc + Number(it.unread ?? 0), 0);
        setUnreadTotal(total);
      } catch {}
    };

    const startPolling = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      void loadUnread();
      if (intervalId != null) window.clearInterval(intervalId);
      intervalId = window.setInterval(loadUnread, pollIntervalMs);
    };

    const handleVisibilityChange = () => {
      if (!active || typeof document === 'undefined') return;
      if (document.visibilityState === 'visible') {
        startPolling();
      } else if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      startPolling();
    }

    return () => {
      active = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const sport = localStorage.getItem(MATCHING_STORAGE_KEYS.sport);
      const level = localStorage.getItem(MATCHING_STORAGE_KEYS.level);
      const date = localStorage.getItem(MATCHING_STORAGE_KEYS.date);
      const distanceKm = localStorage.getItem(MATCHING_STORAGE_KEYS.distance);
      const useGeoloc = localStorage.getItem(MATCHING_STORAGE_KEYS.useGeoloc);
      const lat = localStorage.getItem(MATCHING_STORAGE_KEYS.lat);
      const lng = localStorage.getItem(MATCHING_STORAGE_KEYS.lng);

      if (sport && level && date) {
        const params = new URLSearchParams({ sport, level, date });
        if (distanceKm) params.set('distanceKm', distanceKm);
        if (useGeoloc === '1') params.set('useGeoloc', '1');
        if (lat && lng) {
          params.set('lat', lat);
          params.set('lng', lng);
        }
        setMatchingHref(`/matching/cards?${params.toString()}`);
        setHasMatchingShortcut(true);
      } else {
        setMatchingHref('/matching');
        setHasMatchingShortcut(false);
      }
    } catch {
      setMatchingHref('/matching');
      setHasMatchingShortcut(false);
    }
  }, []);

  const logout = async () => {
    try {
      await apiClient.logoutAll();
    } catch {}
    apiClient.clearTokens();
    router.replace('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center rounded-sm border-2 border-blob-black bg-blob-sand p-3 shadow-sm animate-pulse">
            <Image
              src="/android-chrome-192x192.png"
              alt="Chargement Blob"
              width={64}
              height={64}
              sizes="64px"
              className="w-16 h-16 rounded-full object-contain bg-white/95 p-1 drop-shadow-lg"
              priority
            />

          </div>
          <p className="text-muted-foreground">Chargement de ton espace...</p>
        </div>
      </div>
    );
  }
  if (!user) return null;
  if (user.role === 'PRO') return null;

  const greeting = displayName ? `Salut ${displayName} 👋` : 'Bienvenue sur Blob 👋';
  const matchingCtaLabel = hasMatchingShortcut ? 'Continuer le matching' : 'Commencer le matching';
  const matchingCardText = hasMatchingShortcut
    ? 'Reviens directement sur les profils proposés avec tes derniers filtres actifs.'
    : 'Swipe, matche et organise ta prochaine session avec des riders de ton niveau.';

  return (
    <BlobDashboardShell
      title={greeting}
      nav={[
        { label: 'Dashboard', href: '/dashboard', icon: <Map size={16} /> },
        { label: 'Matching', href: matchingHref, icon: <BlobMark size={16} decorative className="icon-blob-yellow" /> },
        { label: 'Messages', href: '/messages', icon: <MessageSquare size={16} /> },
        { label: 'Profil', href: '/profile', icon: <User size={16} /> },
        { label: 'Compte', href: '/account', icon: <Info size={16} /> },
      ]}
      actions={
        <>
          <NotificationBell />
          <BlobButton asChild variant="outlineDark" size="sm">
            <Link href="/account">Mon compte</Link>
          </BlobButton>
          <BlobButton variant="dark" size="sm" onClick={logout}>
            <LogOut size={14} /> Déconnexion
          </BlobButton>
        </>
      }
    >
      <div className="space-y-6 pb-8">

      {/* Alerts */}
      {showProfilePrompt && (
        <BlobAlert variant="warning" title="Première connexion">
          <p>Complète ton profil pour débloquer le matching et trouver des partenaires de session.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <BlobButton asChild size="sm">
              <Link href="/profile">Compléter mon profil</Link>
            </BlobButton>
            <BlobButton
              size="sm"
              variant="outlineDark"
              onClick={() => setShowProfilePrompt(false)}
            >
              Plus tard
            </BlobButton>
          </div>
        </BlobAlert>
      )}

      {!user?.emailVerified && (
        <BlobAlert variant="info" title="Email non vérifié">
          <p>Confirme ton adresse email pour sécuriser ton compte.</p>
          <BlobButton asChild size="sm" variant="outlineDark" className="mt-3">
            <Link href="/account">Vérifier maintenant</Link>
          </BlobButton>
        </BlobAlert>
      )}

      {/* Section Actions Principales */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
          <h2 className="text-lg font-black uppercase tracking-widest text-blob-black dark:text-white">Ride à deux</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Matching */}
          <Link href={matchingHref} className="group block">
            <BlobCard mode="white" className="h-full">
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow">
                      <BlobMark size={28} decorative />
                    </span>
                    <div>
                      <h3 className="text-2xl font-black uppercase tracking-widest dark:text-white">Matching</h3>
                      <p className="mt-1 text-sm text-blob-black/64 dark:text-white/60">Trouve des partenaires proches</p>
                    </div>
                  </div>
                  {hasMatchingShortcut && (
                    <BlobBadge variant="yellow">Reprise</BlobBadge>
                  )}
                </div>
                <p className="text-sm leading-6 text-blob-black/72 dark:text-white/70">
                  {matchingCardText}
                </p>
                <span className="mt-auto inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest text-blob-black dark:text-white transition-all group-hover:gap-3">
                  {matchingCtaLabel}
                  <span aria-hidden="true">→</span>
                </span>
              </div>
            </BlobCard>
          </Link>

          {/* Messages */}
          <Link href="/messages" className="group block">
            <BlobCard mode="white" className="h-full">
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-11 w-11 items-center justify-center rounded-sm border-2 border-blob-black dark:border-white/40 bg-blob-black text-white">
                      <MessageSquare size={24} />
                      {unreadTotal > 0 && (
                        <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-sm border-2 border-white bg-red-600 px-1 text-[10px] font-black text-white">
                          {unreadTotal}
                        </span>
                      )}
                    </span>
                    <div>
                      <h3 className="flex flex-wrap items-center gap-2 text-2xl font-black uppercase tracking-widest dark:text-white">
                        Messagerie
                        {unreadTotal > 0 && (
                          <BlobBadge variant="error">
                            {unreadTotal} nouveau{unreadTotal > 1 ? 'x' : ''}
                          </BlobBadge>
                        )}
                      </h3>
                      <p className="mt-1 text-sm text-blob-black/64 dark:text-white/60">Tes conversations</p>
                    </div>
                  </div>
                </div>
                <p className="text-sm leading-6 text-blob-black/72 dark:text-white/70">
                  Discute avec tes matchs, organise les détails de vos sessions.
                </p>
                <span className="mt-auto inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest text-blob-black dark:text-white transition-all group-hover:gap-3">
                  Voir mes messages
                  <span aria-hidden="true">→</span>
                </span>
              </div>
            </BlobCard>
          </Link>
        </div>
      </section>

      {/* Section Progresser */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
          <h2 className="text-lg font-black uppercase tracking-widest text-blob-black dark:text-white">Progresser avec un pro</h2>
        </div>
        <BlobCard mode="white">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black dark:border-white/30 bg-blob-sand dark:bg-white/10 text-blob-black dark:text-white">
                <GraduationCap size={20} />
              </span>
              <div>
                <h3 className="flex items-center gap-2 text-xl font-black uppercase tracking-widest dark:text-white">
                  Cours
                </h3>
                <p className="mt-1 text-sm text-blob-black/64 dark:text-white/60">Trouve un moniteur près de chez toi</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col gap-2">
                <BlobButton asChild variant="dark" className="w-full">
                  <Link href="/lesson-request">
                    <RadioTower size={18} />
                    Demander un cours
                  </Link>
                </BlobButton>
                <p className="text-xs text-blob-black/55 dark:text-white/45 leading-relaxed">
                  Les pros voient ta demande sur leur BloboMap et peuvent te proposer un cours adapté à ton niveau.
                </p>
              </div>
            </div>
          </div>
        </BlobCard>
      </section>

      {/* Section Découvrir & Compte - Grille 2 colonnes */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Blobosphère */}
        <Link href="/blobosphere" className="group">
          <BlobCard mode="white" className="h-full">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black dark:border-white/30 bg-blob-sand dark:bg-white/10 text-blob-black dark:text-white">
                  <BookOpen size={20} />
                </span>
                <div>
                  <h3 className="text-xl font-black uppercase tracking-widest dark:text-white">Blobosphère</h3>
                  <p className="mt-1 text-sm text-blob-black/64 dark:text-white/60">Guides & conseils riders</p>
                </div>
              </div>
              <p className="text-sm leading-6 text-blob-black/72 dark:text-white/70">
                Équipement, environnement, santé : tout pour rider en conscience.
              </p>
            </div>
          </BlobCard>
        </Link>

        {/* Profil */}
        <Link href="/profile" className="group">
          <BlobCard mode="white" className="h-full">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                  <User size={20} />
                </span>
                <div>
                  <h3 className="text-xl font-black uppercase tracking-widest dark:text-white">Mon Profil</h3>
                  <p className="mt-1 text-sm text-blob-black/64 dark:text-white/60">Personnalise ton compte</p>
                </div>
              </div>
              <p className="text-sm leading-6 text-blob-black/72 dark:text-white/70">
                Photo, bio, disciplines : rends ton profil attractif pour le matching.
              </p>
            </div>
          </BlobCard>
        </Link>
      </section>

      {/* À propos - Discret en bas */}
      <div className="border-t-2 border-blob-sand-deep dark:border-white/10 pt-4">
        <Link href="/about" className="group flex items-center justify-between rounded-sm border-2 border-transparent p-4 transition-colors hover:border-blob-black dark:hover:border-white/40 hover:bg-white dark:hover:bg-white/5">
          <div className="flex items-center gap-3">
            <Info size={18} className="text-blob-black/64 dark:text-white/60" />
            <div>
              <p className="text-sm font-black uppercase tracking-widest dark:text-white">À propos & RGPD</p>
              <p className="text-xs text-blob-black/64 dark:text-white/60">Sécurité, données et fonctionnement</p>
            </div>
          </div>
          <span className="text-blob-black/64 dark:text-white/60 transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>

      {/* Community dashboard */}
      <CommunityHighlight
        context="dashboard"
        className="max-w-2xl mx-auto mt-4"
      />
      </div>
    </BlobDashboardShell>
  );
}
