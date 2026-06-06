"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { Info, LogOut, ShieldCheck, User } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { requireClientSession, SessionRequiredError } from '../../lib/clientSession';
import { useRouter } from 'next/navigation';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobDashboardShell } from '@/components/blob';

type AuthUser = {
  id: string;
  email: string;
  role: 'RIDER' | 'PRO' | 'ADMIN';
  emailVerified: boolean;
  [key: string]: unknown;
};

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    // No local hint check — truth comes from the server session.
    requireClientSession()
      .then(setUser)
      .catch((err: unknown) => {
        if (err instanceof SessionRequiredError) {
          router.replace('/login');
          return;
        }
        setError('Impossible de charger ton compte pour le moment.');
      })
      .finally(() => setLoading(false));
  }, [router]);

  const logout = async () => {
    try {
      await apiClient.logoutAll();
    } catch {}
    apiClient.clearTokens();
    router.replace('/login');
  };

  const resend = async () => {
    if (!user?.email) return;
    setInfo(null);
    try {
      await apiClient.resendVerification(user.email);
      setInfo('Email de vérification renvoyé. Vérifie ta boîte mail.');
    } catch {
      setError('Impossible de renvoyer l’email de vérification pour le moment.');
    }
  };

  if (loading) {
    return (
      <BlobDashboardShell title="Mon compte">
        <p className="text-sm font-black uppercase tracking-widest text-blob-black/64">Chargement…</p>
      </BlobDashboardShell>
    );
  }

  if (error) {
    return (
      <BlobDashboardShell title="Mon compte">
        <BlobAlert variant="error">{error}</BlobAlert>
      </BlobDashboardShell>
    );
  }

  return (
    <BlobDashboardShell
      title="Mon compte"
      nav={[
        { label: 'Dashboard', href: '/dashboard', icon: <User size={16} /> },
        { label: 'Profil', href: '/profile', icon: <Info size={16} /> },
        { label: 'Messages', href: '/messages', icon: <ShieldCheck size={16} /> },
      ]}
    >
      <div className="mx-auto max-w-2xl space-y-4">
        <BlobCard className="bg-white">
          <div className="space-y-5">
            <div className="flex flex-col gap-2 border-b-2 border-blob-sand-deep pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black uppercase tracking-widest">Identité</h2>
                <p className="mt-1 text-sm text-blob-black/64">Informations principales de ton compte rider.</p>
              </div>
              <BlobBadge variant={user?.emailVerified ? 'success' : 'yellow'}>
                {user?.emailVerified ? 'Vérifié' : 'À vérifier'}
              </BlobBadge>
            </div>

            <dl className="space-y-3 text-sm">
              <div className="flex flex-col gap-1 border-b border-blob-sand-deep/70 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <dt className="font-black uppercase tracking-[0.12em] text-blob-black/56">Email</dt>
                <dd className="break-all font-medium text-blob-black">{user?.email}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-blob-sand-deep/70 pb-3">
                <dt className="font-black uppercase tracking-[0.12em] text-blob-black/56">Rôle</dt>
                <dd className="font-medium text-blob-black">{user?.role}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="font-black uppercase tracking-[0.12em] text-blob-black/56">Email vérifié</dt>
                <dd className="font-medium text-blob-black">{user?.emailVerified ? 'Oui' : 'Non'}</dd>
              </div>
            </dl>

            {!user?.emailVerified && (
              <BlobAlert variant="warning" title="Vérification requise">
                <p>Confirme ton adresse email pour renforcer la sécurité de ton compte.</p>
                <BlobButton
                  onClick={resend}
                  variant="dark"
                  size="sm"
                  className="mt-3 w-full sm:w-auto"
                >
                  Renvoyer l’email de vérification
                </BlobButton>
              </BlobAlert>
            )}

            {info && <BlobAlert variant="success">{info}</BlobAlert>}
          </div>
        </BlobCard>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <BlobButton asChild variant="outlineDark" size="sm">
            <Link href="/dashboard">Retour dashboard</Link>
          </BlobButton>
          <BlobButton
            onClick={logout}
            variant="dark"
            size="sm"
          >
            <LogOut size={14} />
            Se déconnecter
          </BlobButton>
        </div>
      </div>
    </BlobDashboardShell>
  );
}
