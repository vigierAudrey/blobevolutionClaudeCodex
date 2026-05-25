"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { optimizedApiClient } from '../../../lib/optimizedApiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import Link from 'next/link';
import { User, Map, Info, LogOut, MessageSquare, Gift, Sparkles, TrendingUp, Bell, Send, CheckCircle, Activity, Clock } from 'lucide-react';
import { NotificationBell } from '../../../components/NotificationBell';
import { CardSkeleton, PageHeaderSkeleton } from '../../../components/ui/skeleton';
import type { DashboardUser } from '@/types/user';
import { useAnalytics } from '@/hooks/useAnalytics';

type ProDashboardStats = {
  receivedRequests: number;
  readNotifications: number;
  sentContacts: number;
  connectedContacts: number;
  pendingContacts: number;
  connectionRate: number | null;
  acceptedContacts?: number;
  acceptanceRate?: number | null;
  weeklyNotifications: Array<{ week: string; count: number }>;
  weeklyContacts: Array<{ week: string; count: number }>;
  activeNearbyRequests: number;
};

function WeeklyBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground text-xs">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 text-right tabular-nums text-xs">{count}</span>
    </div>
  );
}

export function ProStatsSection({ stats }: { stats: ProDashboardStats }) {
  const connectedContacts = stats.connectedContacts ?? stats.acceptedContacts ?? 0;
  const pendingContacts = stats.pendingContacts ?? Math.max(stats.sentContacts - connectedContacts, 0);
  const connectionRate = stats.connectionRate ?? stats.acceptanceRate ?? null;

  const kpis = [
    {
      label: 'Demandes reçues',
      value: stats.receivedRequests,
      icon: Bell,
      color: 'text-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-950/30',
    },
    {
      label: 'Notifs lues',
      value: stats.readNotifications,
      icon: CheckCircle,
      color: 'text-green-500',
      bg: 'bg-green-50 dark:bg-green-950/30',
    },
    {
      label: 'Demandes envoyées',
      value: stats.sentContacts,
      icon: Send,
      color: 'text-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-950/30',
    },
    {
      label: 'Mises en relation',
      value: connectedContacts,
      icon: TrendingUp,
      color: 'text-amber-500',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
    },
    {
      label: 'Demandes en attente',
      value: pendingContacts,
      icon: Clock,
      color: 'text-cyan-500',
      bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    },
  ];

  const maxNotif = Math.max(...stats.weeklyNotifications.map((w) => w.count), 1);
  const maxContact = Math.max(...stats.weeklyContacts.map((w) => w.count), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-blue-500" />
        <h2 className="font-semibold text-foreground">Mes stats — 7 derniers jours</h2>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`rounded-xl p-3 ${kpi.bg} border border-transparent`}>
            <div className="flex items-center gap-2 mb-1">
              <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
              <span className="text-xs text-muted-foreground">{kpi.label}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Taux de mise en relation + demandes actives */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl p-3 bg-muted/50 border">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs text-muted-foreground">Taux de mise en relation</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
            {connectionRate != null ? `${connectionRate}%` : '—'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">mises en relation / demandes envoyées</p>
        </div>

        <div className="rounded-xl p-3 bg-muted/50 border">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-cyan-500" />
            <span className="text-xs text-muted-foreground">Demandes actives dans ta zone</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
            {stats.activeNearbyRequests}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">riders cherchant un coach</p>
        </div>
      </div>

      {/* Activité récente */}
      {(stats.weeklyNotifications.length > 0 || stats.weeklyContacts.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.weeklyNotifications.length > 0 && (
            <div className="rounded-xl p-3 bg-muted/30 border space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Nouvelles demandes de cours / semaine</p>
              {stats.weeklyNotifications.map((w) => (
                <WeeklyBar key={w.week} label={w.week} count={w.count} max={maxNotif} />
              ))}
            </div>
          )}
          {stats.weeklyContacts.length > 0 && (
            <div className="rounded-xl p-3 bg-muted/30 border space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Demandes de contact pro / semaine</p>
              {stats.weeklyContacts.map((w) => (
                <WeeklyBar key={w.week} label={w.week} count={w.count} max={maxContact} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ProDashboardStats | null>(null);
  const { trackEvent } = useAnalytics();
  const trackedRef = useRef(false);

  useEffect(() => {
    const t = optimizedApiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    optimizedApiClient
      .me()
      .then((u) => {
        if (u.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }
        setUser(u);
        // Fetch stats sans bloquer l'affichage principal
        optimizedApiClient.getProDashboardStats().then(setStats).catch(() => null);
      })
      .catch(() => {
        router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!user || trackedRef.current) return;
    trackedRef.current = true;
    trackEvent({ eventType: 'PRO_DASHBOARD_OPEN' });
  }, [trackEvent, user]);

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
          <NotificationBell />
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

      {/* Ligne 1 : Profil Pro + Messages */}
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

        {/* Messages - Hero Card */}
        <Link href="/pro/messages" className="group block">
          <Card className="h-full overflow-hidden rounded-[1.75rem] border-2 border-purple-200/70 dark:border-white/10 bg-gradient-to-br from-white via-purple-50 to-pink-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                    <MessageSquare size={24}/>
                  </div>
                  <div>
                    <CardTitle className="text-2xl">Messages</CardTitle>
                    <CardDescription className="text-base mt-1">Communiquer avec tes riders</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Gère tes conversations avec tes élèves et futurs élèves.
              </p>
              <div className="inline-flex items-center gap-2 text-purple-600 dark:text-purple-400 font-medium group-hover:gap-3 transition-all">
                Ouvrir mes messages
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Stats MVP */}
      <Card className="rounded-[1.75rem] border overflow-hidden">
        <CardContent className="p-4">
          {stats ? (
            <ProStatsSection stats={stats} />
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <TrendingUp className="w-4 h-4 animate-pulse" />
              Chargement des statistiques…
            </div>
          )}
        </CardContent>
      </Card>

      {/* BloboMap */}
      <div className="grid grid-cols-1 gap-4">
        <Link href="/pro/map" className="group block">
          <Card className="h-full overflow-hidden rounded-[1.75rem] border-2 border-cyan-200/70 dark:border-white/10 bg-gradient-to-br from-white via-cyan-50 to-blue-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 text-white shadow-lg group-hover:scale-110 transition-transform">
                    <Map size={24}/>
                  </div>
                  <div>
                    <CardTitle className="text-2xl">BloboMap</CardTitle>
                    <CardDescription className="text-base mt-1">Demandes de cours autour de toi</CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Carte interactive des riders qui cherchent un coach près de toi.
              </p>
              <div className="inline-flex items-center gap-2 text-cyan-600 dark:text-cyan-400 font-medium group-hover:gap-3 transition-all">
                Voir la carte
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Ligne 3 : Offres Promotionnelles + Notifications - Centrées */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

        <Link href="/pro/settings/notifications" className="group">
          <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-0.5 border-2 border-transparent hover:border-purple-300 rounded-[1.75rem]">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 text-white group-hover:scale-110 transition-transform">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <div>
                  <CardTitle>Notifications</CardTitle>
                  <CardDescription>Personnalise tes alertes</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Choisis quelles demandes de cours tu veux recevoir.
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
