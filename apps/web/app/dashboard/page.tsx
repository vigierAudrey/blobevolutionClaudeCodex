"use client";
import { BookOpen, GraduationCap, Info, LogOut, Map, MessageSquare, RadioTower, Sparkles, Tag, User } from 'lucide-react';
import nextDynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { apiClient } from '../../lib/apiClient';
import loadingBlob from '../../public/images/loading/favicon-96x96.png';

const AdBannerSidebar = nextDynamic(
  () => import('../../components/ads/AdBanner').then((mod) => mod.AdBannerSidebar),
  {
    ssr: false,
    loading: () => <div className="hidden lg:block h-48 rounded-md bg-slate-200/60" aria-hidden="true" />,
  },
);

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
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    apiClient
      .me()
      .then((u) => {
        setUser(u as DashboardUser);
        // First-login banner heuristic: show once per user until dismissed
        const key = `visited-dashboard-${u?.id}`;
        const visited = typeof window !== 'undefined' ? localStorage.getItem(key) : '1';
        if (!visited) setShowProfilePrompt(true);
        if (typeof window !== 'undefined') localStorage.setItem(key, '1');
      })
      .finally(() => setLoading(false));
  }, [router]);

  // Load profile to get displayName
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const [p, d] = await Promise.all([
          apiClient.getProfile(),
          apiClient.getDisciplines().catch(() => []),
        ]);
        if (!active) return;
        if (p?.displayName) {
          setDisplayName(p.displayName);
        }
        const hasName = !!p?.displayName;
        const hasPhoto = !!p?.photoUrl;
        const hasDiscipline = Array.isArray(d) && d.length > 0;
        const incomplete = !hasName || !hasPhoto || !hasDiscipline;
        if (incomplete) {
          router.replace('/onboarding');
        } else {
          setShowProfilePrompt(false);
        }
      } catch (_) {
        // ignore
      }
    })();
    return () => { active = false; };
  }, [user, router]);

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
    if (user?.role === 'PRO') {
      router.replace('/pro/dashboard');
      return;
    }
  }, [user, router]);

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
    } catch (err) {
      console.warn('Matching shortcut unavailable', err);
      setMatchingHref('/matching');
      setHasMatchingShortcut(false);
    }
  }, []);

  const logout = async () => {
    try {
      await apiClient.logoutAll();
    } catch (_) {}
    apiClient.clearTokens();
    router.replace('/login');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-blue-500/30 to-cyan-500/40 p-3 animate-pulse shadow-lg">
            <Image
              src={loadingBlob}
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

  const greeting = displayName ? `Salut ${displayName} 👋` : 'Bienvenue sur BlobConnect 👋';
  const matchingCtaLabel = hasMatchingShortcut ? 'Continuer le matching' : 'Commencer le matching';
  const matchingCardText = hasMatchingShortcut
    ? 'Reviens directement sur les profils proposés avec tes derniers filtres actifs.'
    : 'Swipe, matche et organise ta prochaine session avec des riders de ton niveau.';

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      {/* Hero Header avec gradient */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-400 p-8 text-white shadow-xl">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 left-0 -mb-8 -ml-8 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight flex items-center gap-2">
              {greeting}
            </h1>
            <p className="text-blue-50 text-sm sm:text-base">
              Prêt·e pour ta prochaine session ? Explore, connecte, ride ! 🏄‍♀️
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/account">
              <Button variant="secondary" size="sm" className="bg-white/20 hover:bg-white/30 text-white border-white/30">
                Mon compte
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={logout}
              className="bg-white/20 hover:bg-white/30 text-white border-white/30 inline-flex items-center gap-1.5"
            >
              <LogOut size={14}/> Déconnexion
            </Button>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {showProfilePrompt && (
        <div className="rounded-[1.75rem] border border-amber-200/70 dark:border-amber-500/40 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 px-5 py-4 shadow-sm dark:from-slate-950/70 dark:via-amber-950/30 dark:to-slate-900/40">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0 dark:text-amber-300" />
            <div className="flex-1">
              <p className="font-medium text-amber-900 dark:text-amber-100">Première connexion détectée !</p>
              <p className="text-sm text-amber-800 mt-1 dark:text-amber-100/80">
                Complète ton profil pour débloquer le matching et trouver des partenaires de session.
              </p>
              <div className="mt-3 flex gap-3">
                <Link href="/profile">
                  <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white dark:text-white">
                    Compléter mon profil
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowProfilePrompt(false)}
                  className="text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-white/10"
                >
                  Plus tard
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!user?.emailVerified && (
        <div className="rounded-[1.75rem] border border-blue-200/70 dark:border-blue-500/40 bg-gradient-to-r from-blue-50 via-cyan-50 to-blue-100 px-5 py-4 shadow-sm dark:from-slate-950/70 dark:via-blue-950/30 dark:to-slate-900/40">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0 dark:text-blue-200" />
            <div className="flex-1">
              <p className="font-medium text-blue-900 dark:text-blue-100">Email non vérifié</p>
              <p className="text-sm text-blue-800 mt-1 dark:text-blue-100/80">
                Confirme ton adresse email pour sécuriser ton compte.
              </p>
              <Link href="/account" className="inline-block mt-2">
                <Button size="sm" variant="ghost" className="text-blue-700 p-0 h-auto hover:bg-transparent dark:text-blue-200 dark:hover:bg-white/10">
                  Vérifier maintenant →
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Section Actions Principales */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-blue-500" />
          <h2 className="text-lg font-semibold text-foreground">Ride à deux</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Matching - Hero Card */}
          <Link href={matchingHref} className="group block">
            <Card className="h-full overflow-hidden rounded-[1.75rem] border border-blue-200/70 dark:border-white/8 bg-gradient-to-br from-white via-blue-50 to-cyan-50 dark:from-slate-950/70 dark:via-blue-950/30 dark:to-slate-900/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                      <Map size={24}/>
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Matching</CardTitle>
                      <CardDescription className="text-base mt-1">Trouve des partenaires proches</CardDescription>
                    </div>
                  </div>
                  {hasMatchingShortcut && (
                    <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-100 border border-blue-200/80 dark:border-white/10">
                      Reprise
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {matchingCardText}
                </p>
                <div className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 font-medium group-hover:gap-3 transition-all">
                  {matchingCtaLabel}
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Messages - Hero Card */}
          <Link href="/messages" className="group block">
            <Card className="h-full overflow-hidden rounded-[1.75rem] border border-pink-200/70 dark:border-white/8 bg-gradient-to-br from-white via-pink-50 to-rose-100 dark:from-slate-950/70 dark:via-purple-950/30 dark:to-slate-900/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                      <MessageSquare size={24}/>
                      {unreadTotal > 0 && (
                        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white animate-pulse">
                          {unreadTotal}
                        </span>
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-2xl flex items-center gap-2">
                        Messagerie
                        {unreadTotal > 0 && (
                          <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                            {unreadTotal} nouveau{unreadTotal > 1 ? 'x' : ''}
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription className="text-base mt-1">Tes conversations</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Discute avec tes matchs, organise les détails de vos sessions.
                </p>
                <div className="inline-flex items-center gap-2 text-purple-600 dark:text-purple-400 font-medium group-hover:gap-3 transition-all">
                  Voir mes messages
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Section Progresser */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-emerald-500" />
          <h2 className="text-lg font-semibold text-foreground">Progresser avec un pro</h2>
        </div>
        <Card className="overflow-hidden border-2 border-transparent hover:border-emerald-400 transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
          <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
                <GraduationCap size={20}/>
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  Cours & Bons Plans
                  <Tag size={16} className="text-muted-foreground" />
                </CardTitle>
                <CardDescription>Trouve un moniteur ou profite de promos exclusives</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Bouton 1 : Demander un cours - AVEC TOOLTIP */}
              <div className="relative group/tooltip">
              <Link href="/lesson-request" className="block">
                <Button
                  size="lg"
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 text-base font-semibold"
                >
                    <RadioTower size={18} className="mr-2" />
                    📡 Demander un cours
                  </Button>
                </Link>
                {/* Tooltip custom */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 w-72 opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-300 pointer-events-none z-50">
                  <div className="bg-gradient-to-br from-blue-600 to-indigo-600 text-white px-4 py-3 rounded-2xl shadow-2xl border-2 border-white/20 animate-in fade-in slide-in-from-bottom-2">
                    <p className="text-sm font-medium flex items-start gap-2 leading-relaxed">
                      <span className="text-lg flex-shrink-0">💡</span>
                      <span>Les pros voient ta demande sur leur BloboMap et peuvent te proposer un cours adapté à ton niveau</span>
                    </p>
                    {/* Flèche du tooltip */}
                    <div className="absolute left-1/2 -translate-x-1/2 top-full -mt-px">
                      <div className="w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-indigo-600"></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bouton 3 : Voir les promos */}
              <Link href="/promos" className="group">
                <Button
                  size="lg"
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 text-base font-semibold border-2 border-amber-400/50"
                >
                  <Tag size={18} className="mr-2" />
                  🏷️ Voir les promos
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section Découvrir & Compte - Grille 2 colonnes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Blobosphère */}
        <Link href="/blobosphere" className="group">
          <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-0.5 border-2 border-transparent hover:border-blue-300">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 text-white group-hover:scale-110 transition-transform">
                  <BookOpen size={20}/>
                </div>
                <div>
                  <CardTitle>Blobosphère</CardTitle>
                  <CardDescription>Guides & conseils riders</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Équipement, environnement, santé : tout pour rider en conscience.
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Profil */}
        <Link href="/profile" className="group">
          <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-0.5 border-2 border-transparent hover:border-amber-300">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white group-hover:scale-110 transition-transform">
                  <User size={20}/>
                </div>
                <div>
                  <CardTitle>Mon Profil</CardTitle>
                  <CardDescription>Personnalise ton compte</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Photo, bio, disciplines : rends ton profil attractif pour le matching.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* À propos - Discret en bas */}
      <div className="pt-4 border-t">
        <Link href="/about" className="group flex items-center justify-between p-4 rounded-lg hover:bg-accent transition-colors">
          <div className="flex items-center gap-3">
            <Info size={18} className="text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">À propos & RGPD</p>
              <p className="text-xs text-muted-foreground">Sécurité, données et fonctionnement</p>
            </div>
          </div>
          <span className="text-muted-foreground group-hover:translate-x-1 transition-transform">→</span>
        </Link>
      </div>

      {/* Publicité dashboard */}
      <AdBannerSidebar
        slot="dashboard-sidebar"
        className="max-w-2xl mx-auto"
      />
    </div>
  );
}
