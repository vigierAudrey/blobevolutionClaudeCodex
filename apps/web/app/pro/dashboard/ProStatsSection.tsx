"use client";

import Link from 'next/link';
import { Activity, Bell, CheckCircle, Clock, MessageSquare, Send, TrendingUp } from 'lucide-react';

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
      <span className="w-24 shrink-0 text-xs text-blob-black/60 dark:text-white/55">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-sm bg-blob-sand-deep dark:bg-white/10">
        <div
          className="h-full rounded-sm bg-blob-yellow transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 text-right text-xs tabular-nums text-blob-black/70 dark:text-white/70">{count}</span>
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
    { label: 'Demandes reçues', value: stats.receivedRequests, icon: Bell },
    { label: 'Notifs lues', value: stats.readNotifications, icon: CheckCircle },
    { label: 'Demandes envoyées', value: stats.sentContacts, icon: Send },
    { label: 'Mises en relation', value: connectedContacts, icon: TrendingUp },
    { label: 'Conversations démarrées', value: conversationsStartedCount, icon: MessageSquare },
    { label: 'Demandes en attente', value: pendingContacts, icon: Clock },
    { label: 'Archivées', value: stats.archivedCount ?? 0, icon: Activity },
  ];

  const maxNotif = Math.max(...stats.weeklyNotifications.map((w) => w.count), 1);
  const maxContact = Math.max(...stats.weeklyContacts.map((w) => w.count), 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-blob-black dark:text-white" />
          <h2 className="font-black uppercase tracking-widest text-blob-black dark:text-white">
            Mes stats - 7 derniers jours
          </h2>
        </div>
        <Link
          href="/pro/contact-requests"
          className="inline-flex min-h-10 items-center justify-center rounded-sm border-2 border-blob-black px-3 py-2 text-xs font-black uppercase tracking-widest text-blob-black transition-colors hover:bg-blob-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:border-white/70 dark:text-white dark:hover:bg-white/15"
        >
          Gérer les demandes
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                <kpi.icon className="h-4 w-4" />
              </span>
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-blob-black/62 dark:text-white/60">
                {kpi.label}
              </span>
            </div>
            <p className="mt-3 text-2xl font-black tabular-nums text-blob-black dark:text-white">
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-sm border-2 border-blob-sand-deep bg-white p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-blob-black dark:text-white" />
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-blob-black/62 dark:text-white/60">
              Taux de mise en relation
            </span>
          </div>
          <p className="mt-3 text-2xl font-black tabular-nums text-blob-black dark:text-white">
            {connectionRate != null ? `${connectionRate}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-blob-black/60 dark:text-white/55">
            mises en relation / demandes envoyées
          </p>
        </div>

        <div className="rounded-sm border-2 border-blob-sand-deep bg-white p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blob-black dark:text-white" />
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-blob-black/62 dark:text-white/60">
              Mise en relation → conversation
            </span>
          </div>
          <p className="mt-3 text-2xl font-black tabular-nums text-blob-black dark:text-white">
            {conversationStartRate != null ? `${conversationStartRate}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-blob-black/60 dark:text-white/55">
            premier message réel / mises en relation
          </p>
        </div>

        <div className="rounded-sm border-2 border-blob-sand-deep bg-white p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blob-black dark:text-white" />
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-blob-black/62 dark:text-white/60">
              Demandes actives dans ta zone
            </span>
          </div>
          <p className="mt-3 text-2xl font-black tabular-nums text-blob-black dark:text-white">
            {stats.activeNearbyRequests}
          </p>
          <p className="mt-1 text-xs text-blob-black/60 dark:text-white/55">
            riders cherchant un coach
          </p>
        </div>
      </div>

      {(stats.weeklyNotifications.length > 0 || stats.weeklyContacts.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {stats.weeklyNotifications.length > 0 && (
            <div className="space-y-2 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs font-black uppercase tracking-[0.1em] text-blob-black/65 dark:text-white/60">
                Nouvelles demandes de cours / semaine
              </p>
              {stats.weeklyNotifications.map((w) => (
                <WeeklyBar key={w.week} label={w.week} count={w.count} max={maxNotif} />
              ))}
            </div>
          )}
          {stats.weeklyContacts.length > 0 && (
            <div className="space-y-2 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs font-black uppercase tracking-[0.1em] text-blob-black/65 dark:text-white/60">
                Demandes de contact pro / semaine
              </p>
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
