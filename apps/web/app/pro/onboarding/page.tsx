"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiRequest } from '../../../lib/csrf';
import { BackBar } from '../../../components/BackBar';
import { requireClientRole, RoleMismatchError, SessionRequiredError } from '../../../lib/clientSession';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobMark } from '@/components/blob';

type ProProfile = {
  id: string;
  bio?: string | null;
  photoUrl?: string | null;
  businessName?: string | null;
  // Note: pricePerHour n'est plus utilisé dans l'onboarding
};

function ProOnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Forcer le rechargement quand les searchParams changent (ex: ?refresh=timestamp)
  const refreshTrigger = searchParams.get('refresh');

  useEffect(() => {
    let active = true;

    // Reset les états avant de recharger
    setLoading(true);
    setError(null);
    setRedirecting(false);

    const load = async () => {
      try {
        await requireClientRole('PRO');

        const res = await apiRequest('/pro/me', {
          method: 'GET',
        });
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(
            (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message)
              || (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error)
              || 'Failed to load profile'
          );
        }

        if (!active) return;
        setProfile(body as ProProfile);
      } catch (e) {
        if (!active) return;
        if (e instanceof RoleMismatchError) {
          router.replace('/onboarding');
          return;
        }
        if (e instanceof SessionRequiredError) {
          router.replace('/login');
          return;
        }
        setError('Impossible de charger ton profil pro pour le moment.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [router, refreshTrigger]);

  const hasBusinessName = !!profile?.businessName;
  const hasBio = !!profile?.bio;
  const hasPhoto = !!profile?.photoUrl;

  // Auto-redirect when everything is complete
  useEffect(() => {
    if (loading || error) return;
    const complete = hasBusinessName && hasBio && hasPhoto;
    if (complete) {
      setRedirecting(true);
      const id = setTimeout(() => router.replace('/pro/dashboard'), 800);
      return () => clearTimeout(id);
    }
  }, [loading, error, hasBusinessName, hasBio, hasPhoto, router]);

  return (
    <div className="mx-auto max-w-md space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      <BlobCard mode="yellowSignal">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-black text-blob-yellow">
            <BlobMark size={26} decorative />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-2xl font-black uppercase tracking-widest text-blob-black">
                Bienvenue sur Blob Pro
              </h1>
              <BlobBadge variant="dark">Pro</BlobBadge>
            </div>
            <p className="mt-2 text-sm leading-6 text-blob-black/72">
              Complète ton profil professionnel pour recevoir des demandes utiles autour de ta zone.
            </p>
          </div>
        </div>
      </BlobCard>

      {loading ? (
        <BlobAlert title="Chargement">
          Vérification de ton espace pro...
        </BlobAlert>
      ) : error ? (
        <BlobAlert variant="error" title="Profil indisponible">
          <p>{error}</p>
        </BlobAlert>
      ) : redirecting ? (
        <BlobCard mode="white">
          <div className="space-y-4">
            <BlobAlert variant="success" title="Profil professionnel prêt">
              Redirection vers ton dashboard pro...
            </BlobAlert>
            <BlobButton onClick={() => router.replace('/pro/dashboard')} className="w-full">
              Aller au dashboard pro
            </BlobButton>
          </div>
        </BlobCard>
      ) : (
        <BlobCard mode="white">
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-black uppercase tracking-widest text-blob-black dark:text-white">
                Compléter mon profil professionnel
              </h2>
              <p className="mt-2 text-sm leading-6 text-blob-black/64 dark:text-white/60">
                Ces informations sont requises pour commencer à recevoir des demandes.
              </p>
            </div>
            <ChecklistItem done={hasBusinessName} label="Nom de l'entreprise / activité" />
            <ChecklistItem done={hasBio} label="Description de tes services" />
            <ChecklistItem done={hasPhoto} label="Photo de profil ou logo" />
            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <BlobButton onClick={() => router.push('/pro/profile')} className="w-full sm:flex-1">
                Compléter mon profil pro
              </BlobButton>
              <Link
                href="/pro/dashboard"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-sm border-2 border-blob-black px-4 py-2 text-xs font-black uppercase tracking-widest text-blob-black transition-colors hover:bg-blob-black hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow dark:border-white/70 dark:text-white dark:hover:bg-white/15 sm:flex-1"
              >
                Accéder au dashboard
              </Link>
            </div>
          </div>
        </BlobCard>
      )}
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-2 ${done ? 'border-blob-black bg-blob-yellow text-blob-black' : 'border-blob-black/30 bg-white text-transparent'} font-black`}>
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'text-blob-black/55 line-through dark:text-white/50' : 'text-blob-black dark:text-white'}>{label}</span>
    </div>
  );
}

export default function ProOnboardingPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md space-y-4"><BackBar fallbackHref="/pro/dashboard" /><BlobAlert title="Chargement">Préparation...</BlobAlert></div>}>
      <ProOnboardingInner />
    </Suspense>
  );
}
