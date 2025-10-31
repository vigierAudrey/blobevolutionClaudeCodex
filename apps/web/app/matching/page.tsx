"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { Button } from '../../components/ui/button';
import { apiClient } from '../../lib/apiClient';
import type { DashboardUser } from '@/types/user';
import type { Level, Sport } from '@/types/matching';

const AdBannerFeed = dynamicImport(
  () => import('../../components/ads/AdBanner').then((mod) => mod.AdBannerFeed),
  {
    ssr: false,
    loading: () => <div className="my-6 h-24 rounded-md bg-slate-200/60" aria-hidden="true" />,
  },
);

const levelLabels: Record<Level, string> = { beginner: 'Débutant', intermediate: 'Intermédiaire', advanced: 'Confirmé' };
const SPORT_KEY = 'matching.sport';
const LEVEL_KEY = 'matching.level';

export default function MatchingPage() {
  const router = useRouter();
  const [surfLevel, setSurfLevel] = useState<Level | ''>('');
  const [kiteLevel, setKiteLevel] = useState<Level | ''>('');
  const [chosenSport, setChosenSport] = useState<Sport | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Vérifier le rôle de l'utilisateur
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }
        const currentUser = await apiClient.me() as DashboardUser;

        // Rediriger les PRO vers leur dashboard
        if (currentUser.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }

        // Vérifier si le profil est complet avant d'accéder au matching
        const [profile, disciplines] = await Promise.all([
          apiClient.getProfile() as Promise<Partial<DashboardUser> & { displayName?: string | null; photoUrl?: string | null }>,
          apiClient.getDisciplines().catch(() => []) as Promise<Array<{ sport: Sport; level: Level }>>,
        ]);

        const hasName = Boolean(profile?.displayName);
        const hasPhoto = Boolean(profile?.photoUrl);
        const hasDiscipline = Array.isArray(disciplines) && disciplines.length > 0;
        const incomplete = !hasName || !hasPhoto || !hasDiscipline;

        if (incomplete) {
          router.replace('/onboarding');
          return;
        }

        // Prefill from URL/localStorage
        const url = new URL(window.location.href);
        const qsSport = url.searchParams.get('sport') as Sport | null;
        const qsLevel = url.searchParams.get('level') as Level | null;
        const lsSport = (localStorage.getItem(SPORT_KEY) as Sport | null) || null;
        const lsLevel = (localStorage.getItem(LEVEL_KEY) as Level | null) || null;
        const effSport = qsSport || lsSport;
        const effLevel = (qsLevel || lsLevel) as Level | null;

        if (effSport === 'surf') {
          setChosenSport('surf');
          if (effLevel) setSurfLevel(effLevel);
        }
        if (effSport === 'kitesurf') {
          setChosenSport('kitesurf');
          if (effLevel) setKiteLevel(effLevel);
        }

        // Prefill from profile disciplines only if nothing was set from URL/localStorage
        if (!effSport) {
          const discs = (await apiClient.getDisciplines()) as Array<{ sport: Sport; level: Level }>;
          const surf = discs.find(d => d.sport === 'surf');
          const kite = discs.find(d => d.sport === 'kitesurf');

          if (surf) {
            setSurfLevel(surf.level);
            if (!kite) setChosenSport('surf');
          }
          if (kite) {
            setKiteLevel(kite.level);
            if (!surf) setChosenSport('kitesurf');
          }

          // Don't auto-redirect - let user choose explicitly to avoid infinite loops
        }
      } catch (error) {
        console.error('Error in useEffect:', error);
        router.replace('/login');
      }
    })();
  }, [router]); // Remove problematic dependencies to prevent infinite loop

  const selectSport = (s: Sport) => {
    // Directly set the chosen sport and activate it
    setChosenSport(s);
    if (s === 'surf') {
      if (!surfLevel) setSurfLevel('beginner');
      setKiteLevel(''); // Clear kite level when surf is selected
    } else {
      if (!kiteLevel) setKiteLevel('beginner');
      setSurfLevel(''); // Clear surf level when kite is selected
    }
  };

  const canContinue = useMemo(() => {
    const result = (() => {
      if (!chosenSport) return false;
      if (chosenSport === 'surf') return !!surfLevel;
      return !!kiteLevel;
    })();
    console.log('canContinue:', result, { chosenSport, surfLevel, kiteLevel });
    return result;
  }, [chosenSport, surfLevel, kiteLevel]);

  const breadcrumb = useMemo(() => {
    if (!chosenSport) return 'Aucun sport sélectionné';
    const level = chosenSport === 'surf' ? surfLevel : kiteLevel;
    const levelText = level ? levelLabels[level as Level] : 'niveau non choisi';
    return `${chosenSport === 'surf' ? 'Surf' : 'Kitesurf'} - ${levelText}`;
  }, [chosenSport, surfLevel, kiteLevel]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <div>
        <h1 className="text-2xl font-semibold">Matching</h1>
        <p className="text-sm text-muted-foreground">Choisis le sport et le niveau pour ce matching.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sport et niveau</CardTitle>
          <CardDescription>Sélectionne directement le sport et niveau que tu veux pour ce matching.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => selectSport('surf')} aria-pressed={chosenSport === 'surf'} className={'rounded-md border px-4 py-6 text-center text-sm transition ' + (chosenSport === 'surf' ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')}>Surf</button>
            <button onClick={() => selectSport('kitesurf')} aria-pressed={chosenSport === 'kitesurf'} className={'rounded-md border px-4 py-6 text-center text-sm transition ' + (chosenSport === 'kitesurf' ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')}>Kitesurf</button>
          </div>
          {chosenSport && (
            <div>
              <div className="text-sm mb-1">Niveau {chosenSport === 'surf' ? 'Surf' : 'Kitesurf'}</div>
              <div className="grid grid-cols-3 gap-2">
                {(['beginner','intermediate','advanced'] as Level[]).map(l => {
                  const isSelected = chosenSport === 'surf' ? surfLevel === l : kiteLevel === l;
                  const onClick = chosenSport === 'surf' ? () => setSurfLevel(l) : () => setKiteLevel(l);
                  return (
                    <button key={l} onClick={onClick} aria-pressed={isSelected} className={'rounded-md border px-2 py-2 text-xs transition ' + (isSelected ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')}>{levelLabels[l]}</button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Publicité entre les cartes */}
      <AdBannerFeed
        slot="matching-selection"
        className="max-w-md mx-auto"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ton choix pour ce matching</CardTitle>
          <CardDescription className="text-sm">{breadcrumb}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { setSurfLevel(''); setKiteLevel(''); setChosenSport(null); try { localStorage.removeItem(SPORT_KEY); localStorage.removeItem(LEVEL_KEY); } catch {} }}>Changer de sport</Button>
            <Button disabled={!canContinue} onClick={() => {
              console.log('Continuer clicked:', { canContinue, chosenSport, surfLevel, kiteLevel });
              if (chosenSport === 'surf') {
                console.log('Navigating to surf page...');
                try { localStorage.setItem(SPORT_KEY, 'surf'); localStorage.setItem(LEVEL_KEY, (surfLevel || 'beginner') as string); } catch {}
                router.push(`/matching/date?sport=surf&level=${surfLevel || 'beginner'}`);
              } else if (chosenSport === 'kitesurf') {
                console.log('Navigating to kitesurf page...');
                try { localStorage.setItem(SPORT_KEY, 'kitesurf'); localStorage.setItem(LEVEL_KEY, (kiteLevel || 'beginner') as string); } catch {}
                router.push(`/matching/date?sport=kitesurf&level=${kiteLevel || 'beginner'}`);
              } else {
                console.log('No sport selected');
              }
            }}>Continuer</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
