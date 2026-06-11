"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiRequest } from '../../../lib/csrf';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { requireClientRole, RoleMismatchError, SessionRequiredError } from '../../../lib/clientSession';

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
        console.error('❌ Error loading profile:', e);
        setError(e instanceof Error ? e.message : 'Erreur');
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
    <div className="max-w-md mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      {/* Header compact avec style océan */}
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-blue-100 to-cyan-100 dark:from-blue-900/20 dark:to-cyan-900/20 p-4 border-2 border-blue-200/50 dark:border-blue-800/50">
        <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-md">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Bienvenue sur Blob Pro ! 👋</h1>
          <p className="text-sm text-muted-foreground">Complète ton profil professionnel</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Chargement…</p>
        </div>
      ) : error ? (
        <div className="rounded-2xl border-2 border-red-200 dark:border-red-800/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 p-4">
          <p className="text-sm text-red-700 dark:text-red-300 font-medium">❌ {error}</p>
        </div>
      ) : redirecting ? (
        <Card className="border-2 rounded-[1.75rem]">
          <CardHeader className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30">
            <CardTitle className="text-emerald-900 dark:text-emerald-100">✅ Profil professionnel prêt !</CardTitle>
            <CardDescription className="text-emerald-800 dark:text-emerald-200">
              Redirection vers ton dashboard pro…
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Button onClick={() => router.replace('/pro/dashboard')} className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700">
              Aller au dashboard pro
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-2 rounded-[1.75rem]">
          <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30">
            <CardTitle className="text-foreground">Compléter mon profil professionnel</CardTitle>
            <CardDescription>Toutes ces informations sont requises pour commencer à recevoir des demandes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            <ChecklistItem done={hasBusinessName} label="Nom de l'entreprise / activité" />
            <ChecklistItem done={hasBio} label="Description de tes services" />
            <ChecklistItem done={hasPhoto} label="Photo de profil ou logo" />
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <Button onClick={() => router.push('/pro/profile')} className="flex-1 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700">
                Compléter mon profil pro
              </Button>
              <Link href="/pro/dashboard" className="flex-1 inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm hover:bg-accent">
                Accéder au dashboard
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-sm border-2 ${done ? 'bg-green-600 border-green-600' : 'bg-white border-gray-300'} text-white font-bold`}>
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'line-through text-muted-foreground' : ''}>{label}</span>
    </div>
  );
}

export default function ProOnboardingPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto space-y-4"><BackBar fallbackHref="/pro/dashboard" /><p>Chargement…</p></div>}>
      <ProOnboardingInner />
    </Suspense>
  );
}
