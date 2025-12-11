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
import { Badge } from '../../components/ui/badge';
import { Waves, Wind, Sparkles, Map } from 'lucide-react';

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
    return result;
  }, [chosenSport, surfLevel, kiteLevel]);

  const breadcrumb = useMemo(() => {
    if (!chosenSport) return 'Aucun sport sélectionné';
    const level = chosenSport === 'surf' ? surfLevel : kiteLevel;
    const levelText = level ? levelLabels[level as Level] : 'niveau non choisi';
    return `${chosenSport === 'surf' ? 'Surf' : 'Kitesurf'} - ${levelText}`;
  }, [chosenSport, surfLevel, kiteLevel]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/dashboard" />

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-500 via-cyan-500 to-teal-400 p-8 text-white shadow-xl">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.35),_transparent_55%)]" aria-hidden />
        <div className="relative z-10 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-white/80">
            <Sparkles className="w-4 h-4" />
            Matching Riders
          </div>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-3">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Paramètre ta session parfaite</h1>
              <p className="text-white/90 text-base">
                Choisis ton sport, ton niveau et laisse l’algorithme proposer les riders les plus compatibles autour de toi.
              </p>
            </div>
            <div className="rounded-2xl bg-white/15 px-4 py-3 text-sm space-y-1">
              <p className="font-semibold flex items-center gap-2">
                <Waves className="w-4 h-4" /> 3 étapes rapides
              </p>
              <p className="text-white/80">Sport & niveau → zone → swipe ou liste.</p>
            </div>
          </div>
        </div>
      </section>

      <Card className="border-2">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
              Étape 1
            </Badge>
            <CardTitle className="text-xl">Sport & niveau</CardTitle>
          </div>
          <CardDescription>
            Fais ton choix pour cette session. Tu peux réutiliser tes préférences plus tard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => selectSport('surf')}
              aria-pressed={chosenSport === 'surf'}
              className={`rounded-2xl border-2 px-5 py-6 text-left transition-all shadow-sm hover:shadow-md ${
                chosenSport === 'surf'
                  ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-200'
                  : 'border-border hover:border-blue-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-blue-500/10 p-3">
                  <Waves className="text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold">Surf</p>
                  <p className="text-sm text-muted-foreground">
                    Sessions douces, shortboard ou longboard : trouve un binôme à ton rythme.
                  </p>
                </div>
              </div>
            </button>
            <button
              onClick={() => selectSport('kitesurf')}
              aria-pressed={chosenSport === 'kitesurf'}
              className={`rounded-2xl border-2 px-5 py-6 text-left transition-all shadow-sm hover:shadow-md ${
                chosenSport === 'kitesurf'
                  ? 'border-purple-500 bg-purple-50/80 ring-2 ring-purple-200'
                  : 'border-border hover:border-purple-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-purple-500/10 p-3">
                  <Wind className="text-purple-600" />
                </div>
                <div>
                  <p className="font-semibold">Kitesurf</p>
                  <p className="text-sm text-muted-foreground">
                    Sessions ventées et downwinds. Active ce mode pour ton aile préférée.
                  </p>
                </div>
              </div>
            </button>
          </div>

          {chosenSport && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-full">
                  Niveau {chosenSport === 'surf' ? 'Surf' : 'Kitesurf'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Ajuste ton niveau pour des matchs plus précis
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['beginner','intermediate','advanced'] as Level[]).map((l) => {
                  const isSelected = chosenSport === 'surf' ? surfLevel === l : kiteLevel === l;
                  const onClick = chosenSport === 'surf' ? () => setSurfLevel(l) : () => setKiteLevel(l);
                  return (
                    <button
                      key={l}
                      onClick={onClick}
                      aria-pressed={isSelected}
                      className={`rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                        isSelected
                          ? 'border-teal-500 bg-teal-50/80 ring-2 ring-teal-200'
                          : 'border-border hover:border-teal-200'
                      }`}
                    >
                      {levelLabels[l]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AdBannerFeed slot="matching-selection" className="max-w-xl mx-auto" />

      <Card className="border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Map className="w-5 h-5 text-muted-foreground" />
            Ton plan du jour
          </CardTitle>
          <CardDescription className="text-sm">{breadcrumb}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
            Une fois validé, tu passeras à la zone géo puis au calendrier pour verrouiller la session.
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setSurfLevel('');
                setKiteLevel('');
                setChosenSport(null);
                try { localStorage.removeItem(SPORT_KEY); localStorage.removeItem(LEVEL_KEY); } catch {}
              }}
              className="flex-1 sm:flex-none"
            >
              Réinitialiser
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              disabled={!canContinue}
              onClick={() => {
                if (chosenSport === 'surf') {
                  try { localStorage.setItem(SPORT_KEY, 'surf'); localStorage.setItem(LEVEL_KEY, (surfLevel || 'beginner') as string); } catch {}
                  router.push(`/matching/date?sport=surf&level=${surfLevel || 'beginner'}`);
                } else if (chosenSport === 'kitesurf') {
                  try { localStorage.setItem(SPORT_KEY, 'kitesurf'); localStorage.setItem(LEVEL_KEY, (kiteLevel || 'beginner') as string); } catch {}
                  router.push(`/matching/date?sport=kitesurf&level=${kiteLevel || 'beginner'}`);
                }
              }}
            >
              Continuer vers la zone
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Localisation', description: 'Active ta position et choisis ton rayon.', color: 'from-blue-500/10 to-blue-500/5' },
          { label: 'Calendrier', description: 'Sélectionne la date idéale + option cours.', color: 'from-purple-500/10 to-purple-500/5' },
          { label: 'Swipe ou liste', description: 'Deck immersif ou liste détaillée.', color: 'from-emerald-500/10 to-emerald-500/5' },
        ].map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl border px-4 py-5 bg-gradient-to-br ${card.color} shadow-sm`}
          >
            <p className="text-sm font-semibold">{card.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
