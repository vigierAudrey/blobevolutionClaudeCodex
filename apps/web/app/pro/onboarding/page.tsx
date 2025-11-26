"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '../../../lib/apiClient';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

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
    // Reset les états avant de recharger
    setLoading(true);
    setError(null);
    setRedirecting(false);

    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }

    // Vérifier que l'utilisateur est bien un PRO
    apiClient.me()
      .then((user) => {
        if (user.role !== 'PRO') {
          router.replace('/onboarding');
          return null;
        }

        // ✅ CORRIGÉ : Appeler /pro/me au lieu de /profile/me
        return fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${t.accessToken}`,
            'Content-Type': 'application/json'
          },
          credentials: 'include',
        }).then(async (res) => {
          if (!res.ok) throw new Error('Failed to load profile');
          return res.json();
        });
      })
      .then((p) => {
        if (p) {
          console.log('📋 ProProfile loaded:', p);
          setProfile(p);
        }
      })
      .catch((e) => {
        console.error('❌ Error loading profile:', e);
        setError(e?.message || 'Erreur');
      })
      .finally(() => setLoading(false));
  }, [router, refreshTrigger]);

  const hasBusinessName = !!profile?.businessName;
  const hasBio = !!profile?.bio;
  const hasPhoto = !!profile?.photoUrl;

  // Debug logs
  console.log('✅ Checklist status:', {
    hasBusinessName,
    hasBio,
    hasPhoto,
    profile
  });

  // Auto-redirect when everything is complete
  useEffect(() => {
    if (loading || error) return;
    const complete = hasBusinessName && hasBio && hasPhoto;
    console.log('🔍 Onboarding complete?', complete);
    if (complete) {
      console.log('🎉 Profile complete! Redirecting to dashboard...');
      setRedirecting(true);
      const id = setTimeout(() => router.replace('/pro/dashboard'), 800);
      return () => clearTimeout(id);
    }
  }, [loading, error, hasBusinessName, hasBio, hasPhoto, router]);

  return (
    <div className="max-w-md mx-auto space-y-4">
      <BackBar fallbackHref="/pro/dashboard" />
      <h1 className="text-2xl font-semibold">Bienvenue sur Blobinfini Pro !</h1>
      <p className="text-muted-foreground">Complète ces informations obligatoires pour accéder à ton espace professionnel.</p>

      {loading ? (
        <p>Chargement…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : redirecting ? (
        <Card>
          <CardHeader>
            <CardTitle>Profil professionnel prêt !</CardTitle>
            <CardDescription>Redirection vers ton dashboard pro…</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.replace('/pro/dashboard')}>Aller au dashboard pro</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Compléter mon profil professionnel</CardTitle>
            <CardDescription>Toutes ces informations sont requises pour commencer à recevoir des demandes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChecklistItem done={hasBusinessName} label="Nom de l'entreprise / activité" />
            <ChecklistItem done={hasBio} label="Description de tes services" />
            <ChecklistItem done={hasPhoto} label="Photo de profil ou logo" />
            <div className="pt-2 flex gap-2">
              <Button onClick={() => router.push('/pro/profile')}>Compléter mon profil pro</Button>
              <Link href="/pro/dashboard" className="inline-flex items-center rounded-md border px-4 py-2 text-sm">
                Accéder au dashboard pro
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
