"use client";

import { TrendingUp, CheckCircle, Send, MessageSquare, Activity, Clock, Bell } from 'lucide-react';

export type ProDashboardStats = {
  receivedRequests: number;
  readNotifications: number;
  sentContacts: number;
  connectedContacts: number;
  pendingContacts: number;
  connectionRate: number | null;
  conversationsStartedCount: number;
  conversationStartRate: number | null;
  acceptedContacts?: number;
  acceptanceRate?: number | null;
  weeklyNotifications: Array<{ week: string; count: number }>;
  weeklyContacts: Array<{ week: string; count: number }>;
  activeNearbyRequests: number;
  archivedCount?: number;
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
  const conversationsStartedCount = stats.conversationsStartedCount ?? 0;
  const conversationStartRate = stats.conversationStartRate ?? null;

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
      label: 'Conversations démarrées',
      value: conversationsStartedCount,
      icon: MessageSquare,
      color: 'text-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    },
    {
      label: 'Demandes en attente',
      value: pendingContacts,
      icon: Clock,
      color: 'text-cyan-500',
      bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    },
    {
      label: 'Archivées',
      value: stats.archivedCount ?? 0,
      icon: Activity,
      color: 'text-slate-500',
      bg: 'bg-slate-50 dark:bg-slate-950/30',
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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

      {/* Lien rapide vers la gestion des demandes */}
      <div className="flex justify-end">
        <a
          href="/pro/contact-requests"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          Gérer les demandes de contact →
        </a>
      </div>

      {/* Taux de mise en relation + demandes actives */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <MessageSquare className="w-4 h-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">Mise en relation → conversation</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {conversationStartRate != null ? `${conversationStartRate}%` : '—'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">premier message réel / mises en relation</p>
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
