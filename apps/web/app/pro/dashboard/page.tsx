"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { optimizedApiClient, measureApiPerformance } from '../../../lib/optimizedApiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import Link from 'next/link';
import { Badge } from '../../../components/ui/badge';
import { User, Map, Percent, Info, LogOut, BookOpen, MessageSquare, Gift, Sparkles } from 'lucide-react';
import { CardSkeleton, PageHeaderSkeleton } from '../../../components/ui/skeleton';
import type { DashboardUser } from '@/types/user';

const DEFAULT_PLANNING_STATS = { availabilityCount: 0, pendingCount: 0 };

export default function ProDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [planningStats, setPlanningStats] = useState<{ availabilityCount: number; pendingCount: number } | null>(null);

  const loadPlanningStats = useCallback(async () => {
    try {
      const perf = measureApiPerformance('Pro Dashboard Data');

      // Use optimized parallel initialization
      const { availabilities, inbox } = await optimizedApiClient.initializePro();

      const pendingCount = inbox.requests.filter((req) => req.status === 'PENDING').length;
      setPlanningStats({ availabilityCount: availabilities.availabilities.length, pendingCount });

      perf.end();
    } catch (error: unknown) {
      console.error('Pro dashboard initialization failed:', error);
      setPlanningStats({ ...DEFAULT_PLANNING_STATS });
    }
  }, []);

  useEffect(() => {
    const t = optimizedApiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    optimizedApiClient
      .me()
      .then((u) => {
        // Vérifier que l'utilisateur est bien un PRO
        if (u.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }
        setUser(u);
        void loadPlanningStats();
      })
      .catch(() => {
        router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [loadPlanningStats, router]);

  const logout = async () => {
    try {
      await optimizedApiClient.logoutAll();
    } catch {
      // ignore
    }
    optimizedApiClient.clearTokens();
    router.replace('/login');
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeaderSkeleton />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }
  if (!user) return null;

  const safePlanningStats = planningStats ?? DEFAULT_PLANNING_STATS;
  const availabilityLabel = planningStats
    ? `${safePlanningStats.availabilityCount} créneau${safePlanningStats.availabilityCount > 1 ? 'x' : ''}`
    : '-- créneaux';
  const pendingLabel = planningStats
    ? `${safePlanningStats.pendingCount} demande${safePlanningStats.pendingCount > 1 ? 's' : ''} en attente`
    : '-- demandes';
  const hasPendingRequests = safePlanningStats.pendingCount > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      {/* Header compact avec style océan */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-blue-100 to-cyan-100 dark:from-blue-900/20 dark:to-cyan-900/20 p-4 border-2 border-blue-200/50 dark:border-blue-800/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-md">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Dashboard Professionnel 💼</h1>
            <p className="text-sm text-muted-foreground">Bienvenue, {user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/account">
            <Button variant="ghost" size="sm">
              Mon compte
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={logout} className="inline-flex items-center gap-1.5">
            <LogOut size={14}/> Déconnexion
          </Button>
        </div>
      </div>

      {/* Alertes */}
      {!user?.emailVerified && (
        <div className="rounded-[1.75rem] border border-blue-200/70 dark:border-blue-500/40 bg-gradient-to-r from-blue-50 via-cyan-50 to-blue-100 px-5 py-4 shadow-sm dark:from-slate-950/70 dark:via-blue-950/30 dark:to-slate-900/40">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0 dark:text-blue-200" />
            <div className="flex-1">
              <p className="font-medium text-blue-900 dark:text-blue-100">Email non vérifié</p>
              <p className="text-sm text-blue-800 mt-1 dark:text-blue-100/80">
                Confirme ton adresse email pour sécuriser ton compte pro.
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

      <div className="rounded-[1.75rem] border border-amber-200/70 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-100 px-5 py-4 shadow-sm dark:border-amber-900/40 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900">
        <div className="flex items-start gap-3">
          <Map className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0 dark:text-amber-300" />
          <div className="flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-100">Renseigne ta localisation</p>
            <p className="text-sm text-amber-800 mt-1 dark:text-amber-100/80">
              Ta latitude/longitude sont obligatoires pour apparaître dans la recherche des riders et calculer les distances. Ton adresse précise n’est pas affichée.
            </p>
            <Link href="/pro/profile" className="inline-block mt-2">
              <Button size="sm" variant="ghost" className="text-amber-800 p-0 h-auto hover:bg-transparent dark:text-amber-100 dark:hover:bg-white/10">
                Mettre à jour ma localisation →
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Section Gérer mon activité */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-blue-500" />
          <h2 className="text-lg font-semibold text-foreground">Gérer mon activité</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Profil Pro - Hero Card */}
          <Link href="/pro/profile" className="group block">
            <Card className="h-full overflow-hidden rounded-[1.75rem] border-2 border-amber-200/70 dark:border-white/10 bg-gradient-to-br from-white via-amber-50 to-orange-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                      <User size={24}/>
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Profil Pro</CardTitle>
                      <CardDescription className="text-base mt-1">Renseigne tes infos professionnelles</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Nom commercial, bio, tarif, logo : tout pour attirer tes futurs élèves.
                </p>
                <div className="inline-flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium group-hover:gap-3 transition-all">
                  Ouvrir mon profil
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Réservations - Hero Card */}
          <Link href="/pro/planning" className="group block">
            <Card className="h-full overflow-hidden rounded-[1.75rem] border-2 border-emerald-200/70 dark:border-white/10 bg-gradient-to-br from-white via-emerald-50 to-teal-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                      <BookOpen size={24}/>
                      {hasPendingRequests && (
                        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white animate-pulse">
                          {safePlanningStats.pendingCount}
                        </span>
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-2xl flex items-center gap-2">
                        Réservations
                        {hasPendingRequests && (
                          <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                            {safePlanningStats.pendingCount} en attente
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription className="text-base mt-1">Créneaux et demandes</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge variant="outline" className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200">
                    {availabilityLabel}
                  </Badge>
                  {hasPendingRequests && (
                    <Badge variant="secondary" className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                      {pendingLabel}
                    </Badge>
                  )}
                </div>
                <div className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium group-hover:gap-3 transition-all">
                  Ouvrir mon planning
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Section Trouver des élèves */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-cyan-500" />
          <h2 className="text-lg font-semibold text-foreground">Trouver des élèves</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* BloboMap */}
          <Link href="/pro/map" className="group">
            <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-0.5 border-2 border-transparent hover:border-cyan-300 rounded-[1.75rem]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 text-white group-hover:scale-110 transition-transform">
                    <Map size={20}/>
                  </div>
                  <div>
                    <CardTitle>BloboMap</CardTitle>
                    <CardDescription>Demandes de cours autour de toi</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Carte interactive des riders qui cherchent un coach près de toi.
                </p>
              </CardContent>
            </Card>
          </Link>

          {/* Créneaux & réservations */}
          <Link href="/pro/planning" className="group">
            <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-0.5 border-2 border-transparent hover:border-emerald-300 rounded-[1.75rem]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white group-hover:scale-110 transition-transform">
                    <Calendar size={20}/>
                  </div>
                  <div>
                    <CardTitle>Mes créneaux & réservations</CardTitle>
                    <CardDescription>Publier, suivre et gérer tes slots</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Crée des disponibilités, vois les demandes et confirme les réservations en un clin d’œil.
                </p>
              </CardContent>
            </Card>
          </Link>

        </div>
      </div>

      {/* Section Communication & Promos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Messages */}
        <Link href="/pro/messages" className="group">
          <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-0.5 border-2 border-transparent hover:border-purple-300 rounded-[1.75rem]">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 text-white group-hover:scale-110 transition-transform">
                  <MessageSquare size={20}/>
                </div>
                <div>
                  <CardTitle>Messages</CardTitle>
                  <CardDescription>Communiquer avec tes riders</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Gère tes conversations avec tes élèves et futurs élèves.
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* Offres Promotionnelles */}
        <Link href="/pro/promos" className="group">
          <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-0.5 border-2 border-transparent hover:border-amber-300 rounded-[1.75rem]">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white group-hover:scale-110 transition-transform">
                  <Gift size={20}/>
                </div>
                <div>
                  <CardTitle>Offres Promotionnelles</CardTitle>
                  <CardDescription>Partenariats et promotions</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Découvre les opportunités de visibilité et de collaboration.
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
    </div>
  );
}
