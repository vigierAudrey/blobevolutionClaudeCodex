"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../lib/apiClient';
import { requireClientSession, SessionRequiredError } from '../../lib/clientSession';
import { BackBar } from '../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import type { DisciplinePreference, UserProfile } from '@/types/user';

const getErrorMessage = (error: unknown, fallback = 'Erreur') => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [disciplines, setDisciplines] = useState<DisciplinePreference[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No local hint check — truth comes from the server session.
    requireClientSession()
      .then((user) => {
        if (user.role === 'PRO') {
          router.replace('/pro/onboarding');
          return;
        }
        if (user.role === 'ADMIN') {
          router.replace('/admin/dashboard');
          return;
        }

        return Promise.all([
          apiClient.getProfile().catch((profileError) => {
            throw new Error(getErrorMessage(profileError, 'Erreur profil'));
          }) as Promise<UserProfile>,
          apiClient.getDisciplines().catch(() => [] as DisciplinePreference[]),
        ]);
      })
      .then((result) => {
        if (result) {
          const [p, d] = result;
          setProfile(p);
          setDisciplines(Array.isArray(d) ? d : []);
        }
      })
      .catch((err) => {
        if (err instanceof SessionRequiredError) {
          router.replace('/login');
          return;
        }
        setError(getErrorMessage(err, 'Erreur'));
      })
      .finally(() => setLoading(false));
  }, [router]);

  const hasName = !!profile?.displayName;
  const hasDiscipline = (disciplines?.length || 0) > 0;
  const hasPhoto = Boolean(profile?.hasPhoto);

  // Auto-redirect when everything is complete
  useEffect(() => {
    if (loading || error) return;
    const complete = hasName && hasDiscipline && hasPhoto;
    if (complete) {
      router.replace('/dashboard');
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
