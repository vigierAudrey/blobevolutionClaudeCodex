"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bell,
  Info,
  LogOut,
  Map,
  MessageSquare,
  RadioTower,
  Settings,
  Sparkles,
  TrendingUp,
  User,
} from 'lucide-react';
import { NotificationBell } from '../../../components/NotificationBell';
import type { DashboardUser } from '@/types/user';
import { useAnalytics } from '@/hooks/useAnalytics';
import { optimizedApiClient } from '../../../lib/optimizedApiClient';
import {
  BlobAlert,
  BlobBadge,
  BlobButton,
  BlobCard,
  BlobDashboardShell,
} from '@/components/blob';
import { ProStatsSection } from './ProStatsSection';
import type { ProDashboardStats } from './ProStatsSection';

type ProActionCardProps = {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  cta: string;
  badge?: string;
  mode?: 'white' | 'sand' | 'yellowSignal';
};

function ProActionCard({
  href,
  icon,
  title,
  description,
  cta,
  badge,
  mode = 'white',
}: ProActionCardProps) {
  return (
    <Link href={href} className="group block h-full">
      <BlobCard mode={mode} className="h-full">
        <div className="flex h-full flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black dark:border-white/40">
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words text-xl font-black uppercase tracking-widest text-blob-black dark:text-white">
                  {title}
                </h3>
                {badge && <BlobBadge variant="yellow">{badge}</BlobBadge>}
              </div>
              <p className="mt-1 text-sm leading-6 text-blob-black/64 dark:text-white/60">
                {description}
              </p>
            </div>
          </div>
          <span className="mt-auto inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest text-blob-black transition-all group-hover:gap-3 dark:text-white">
            {cta}
            <span aria-hidden="true">→</span>
          </span>
        </div>
      </BlobCard>
    </Link>
  );
}

function ProDashboardLoading() {
  return (
    <BlobDashboardShell title="Espace pro">
      <div className="space-y-4 pb-8" aria-busy="true" aria-live="polite">
        <BlobAlert title="Chargement">
          Préparation de ton espace professionnel...
        </BlobAlert>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <BlobCard key={index} mode="white" className="min-h-36 animate-pulse">
              <div className="space-y-3">
                <div className="h-4 w-2/3 rounded-sm bg-blob-sand-deep dark:bg-white/15" />
                <div className="h-3 w-full rounded-sm bg-blob-sand-deep dark:bg-white/15" />
                <div className="h-3 w-3/4 rounded-sm bg-blob-sand-deep dark:bg-white/15" />
              </div>
            </BlobCard>
          ))}
        </div>
      </div>
    </BlobDashboardShell>
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
        // Fetch stats sans bloquer l'affichage principal.
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
    return <ProDashboardLoading />;
  }
  if (!user) return null;

  return (
    <BlobDashboardShell
      title="Espace pro"
      nav={[
        { label: 'Dashboard', href: '/pro/dashboard', icon: <Sparkles size={16} /> },
        { label: 'Demandes', href: '/pro/contact-requests', icon: <RadioTower size={16} /> },
        { label: 'Carte', href: '/pro/map', icon: <Map size={16} /> },
        { label: 'Messages', href: '/pro/messages', icon: <MessageSquare size={16} /> },
        { label: 'Profil', href: '/pro/profile', icon: <User size={16} /> },
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
        <BlobCard mode="yellowSignal">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blob-black/65">
                Pro Blob
              </p>
              <h2 className="mt-2 text-2xl font-black uppercase tracking-widest text-blob-black">
                Pilote tes demandes
              </h2>
              <p className="mt-2 break-words text-sm leading-6 text-blob-black/72">
                Connecte-toi aux riders proches de ta zone, sans réservation ni paiement sur la plateforme.
              </p>
            </div>
            <BlobBadge variant="dark">Compte pro</BlobBadge>
          </div>
        </BlobCard>

        {!user.emailVerified && (
          <BlobAlert variant="info" title="Email non vérifié">
            <p>Confirme ton adresse email pour sécuriser ton compte pro.</p>
            <BlobButton asChild size="sm" variant="outlineDark" className="mt-3">
              <Link href="/account">Vérifier maintenant</Link>
            </BlobButton>
          </BlobAlert>
        )}

        <BlobAlert variant="warning" title="Localisation pro">
          <p>
            Ta latitude/longitude sont obligatoires pour apparaître dans la recherche des riders et calculer les distances.
            Ton adresse précise n&apos;est pas affichée.
          </p>
          <BlobButton asChild size="sm" variant="outlineDark" className="mt-3">
            <Link href="/pro/profile">Mettre à jour ma localisation</Link>
          </BlobButton>
        </BlobAlert>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
            <h2 className="text-lg font-black uppercase tracking-widest text-blob-black dark:text-white">
              Actions rapides
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ProActionCard
              href="/pro/profile"
              icon={<User size={24} />}
              title="Profil pro"
              description="Nom commercial, bio, logo et zone d'activité pour inspirer confiance aux riders."
              cta="Ouvrir mon profil"
            />
            <ProActionCard
              href="/pro/messages"
              icon={<MessageSquare size={24} />}
              title="Messages"
              description="Gère les échanges avec les riders et transforme les demandes en mise en relation claire."
              cta="Ouvrir mes messages"
            />
            <ProActionCard
              href="/pro/map"
              icon={<Map size={24} />}
              title="BloboMap"
              description="Repère les demandes de cours autour de ta zone, sans exposer d'adresse privée."
              cta="Voir la carte"
              badge="Terrain"
            />
            <ProActionCard
              href="/pro/contact-requests"
              icon={<Bell size={24} />}
              title="Demandes"
              description="Suis les demandes de contact et traite les opportunités encore en attente."
              cta="Gérer les demandes"
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
            <h2 className="text-lg font-black uppercase tracking-widest text-blob-black dark:text-white">
              Activité pro
            </h2>
          </div>
          <BlobCard mode="white">
            {stats ? (
              <ProStatsSection stats={stats} />
            ) : (
              <div className="flex min-h-32 items-center gap-3 text-sm text-blob-black/70 dark:text-white/70" aria-live="polite">
                <TrendingUp className="h-5 w-5 animate-pulse text-blob-black dark:text-white" />
                Chargement des statistiques...
              </div>
            )}
          </BlobCard>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ProActionCard
            href="/pro/settings/notifications"
            icon={<Settings size={22} />}
            title="Notifications"
            description="Choisis les alertes de demandes de cours utiles entre deux sessions."
            cta="Régler mes alertes"
            mode="sand"
          />
        </section>

        <div className="border-t-2 border-blob-sand-deep pt-4 dark:border-white/10">
          <Link
            href="/about"
            className="group flex items-center justify-between rounded-sm border-2 border-transparent p-4 transition-colors hover:border-blob-black hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:hover:border-white/40 dark:hover:bg-white/5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Info size={18} className="shrink-0 text-blob-black/64 dark:text-white/60" />
              <div className="min-w-0">
                <p className="text-sm font-black uppercase tracking-widest text-blob-black dark:text-white">
                  À propos &amp; RGPD
                </p>
                <p className="text-xs text-blob-black/64 dark:text-white/60">
                  Sécurité, données et fonctionnement
                </p>
              </div>
            </div>
            <span className="shrink-0 text-blob-black/64 transition-transform group-hover:translate-x-1 dark:text-white/60">
              →
            </span>
          </Link>
        </div>
      </div>
    </BlobDashboardShell>
  );
}
