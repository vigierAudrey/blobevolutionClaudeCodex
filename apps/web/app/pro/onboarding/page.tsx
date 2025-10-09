"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '../../../lib/apiClient';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

type ProProfile = {
  id: string;
  displayName?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  businessName?: string | null;
  hourlyRate?: number | null;
};

export default function ProOnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
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
          return;
        }

        return apiClient.getProfile();
      })
      .then((p) => {
        setProfile(p);
      })
      .catch((e) => setError(e?.message || 'Erreur'))
      .finally(() => setLoading(false));
  }, [router]);

  const hasBusinessName = !!profile?.businessName;
  const hasDisplayName = !!profile?.displayName;
  const hasBio = !!profile?.bio;
  const hasPhoto = !!profile?.photoUrl;
  const hasRate = !!profile?.hourlyRate;

  // Auto-redirect when everything is complete
  useEffect(() => {
    if (loading || error) return;
    const complete = hasBusinessName && hasDisplayName && hasBio && hasPhoto && hasRate;
    if (complete) {
      setRedirecting(true);
      const id = setTimeout(() => router.replace('/pro/dashboard'), 800);
      return () => clearTimeout(id);
    }
  }, [loading, error, hasBusinessName, hasDisplayName, hasBio, hasPhoto, hasRate, router]);

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
            <ChecklistItem done={hasDisplayName} label="Nom d'affichage (prénom ou pseudo)" />
            <ChecklistItem done={hasBio} label="Description de tes services" />
            <ChecklistItem done={hasPhoto} label="Photo de profil ou logo" />
            <ChecklistItem done={hasRate} label="Tarif horaire indicatif" />
            <div className="pt-2 flex gap-2">
              <Button onClick={() => router.push('/pro/profile')}>Compléter mon profil pro</Button>
              <Link href="/pro/dashboard" className="inline-flex items-center rounded-md border px-4 py-2 text-sm">
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
      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border ${done ? 'bg-green-600 border-green-600' : 'bg-white'} text-white`}>{done ? '✓' : ''}</span>
      <span className={done ? 'line-through text-muted-foreground' : ''}>{label}</span>
    </div>
  );
}