"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '../../lib/apiClient';
import { BackBar } from '../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';

type Profile = {
  id: string;
  displayName?: string | null;
  bio?: string | null;
  photoUrl?: string | null;
  maxDistanceKm?: number | null;
  partnerPref?: string | null;
  emailNotif?: boolean | null;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [disciplines, setDisciplines] = useState<Array<{ sport: string; level: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    Promise.all([
      apiClient.getProfile().catch((e) => {
        throw new Error(e?.message || 'Erreur profil');
      }),
      apiClient.getDisciplines().catch(() => []),
    ])
      .then(([p, d]) => {
        setProfile(p);
        setDisciplines(d as any);
      })
      .catch((e) => setError(e?.message || 'Erreur'))
      .finally(() => setLoading(false));
  }, [router]);

  const hasName = !!profile?.displayName;
  const hasDiscipline = (disciplines?.length || 0) > 0;
  const hasPhoto = !!profile?.photoUrl;

  // Debug info
  console.log('Onboarding status:', {
    hasName,
    displayName: profile?.displayName,
    hasDiscipline,
    disciplinesCount: disciplines?.length,
    hasPhoto,
    photoUrl: profile?.photoUrl,
  });

  // Auto-redirect when everything is complete
  useEffect(() => {
    if (loading || error) return;
    const complete = hasName && hasDiscipline && hasPhoto;
    if (complete) {
      setRedirecting(true);
      const id = setTimeout(() => router.replace('/dashboard'), 800);
      return () => clearTimeout(id);
    }
  }, [loading, error, hasName, hasDiscipline, hasPhoto, router]);

  return (
    <div className="max-w-md mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <h1 className="text-2xl font-semibold">Bienvenue !</h1>
      <p className="text-muted-foreground">Complète ces 3 étapes obligatoires pour accéder au matching.</p>

      {loading ? (
        <p>Chargement…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : redirecting ? (
        <Card>
          <CardHeader>
            <CardTitle>Tout est prêt !</CardTitle>
            <CardDescription>Redirection vers le tableau de bord…</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.replace('/dashboard')}>Aller au dashboard</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Compléter mon profil</CardTitle>
            <CardDescription>Toutes ces informations sont requises pour commencer le matching.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChecklistItem done={hasName} label="Ajouter un pseudo (nom d'affichage requis)" />
            <ChecklistItem done={hasDiscipline} label="Choisir au moins un sport + niveau" />
            <ChecklistItem done={hasPhoto} label="Ajouter une photo de profil" />
            <div className="pt-2 flex gap-2">
              <Button onClick={() => router.push('/profile')}>Ouvrir mon profil</Button>
              <Link href="/matching" className="inline-flex items-center rounded-md border px-4 py-2 text-sm">
                Passer au matching
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
