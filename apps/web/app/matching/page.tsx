"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { apiClient } from '../../lib/apiClient';
import type { DashboardUser } from '@/types/user';
import type { Level, Sport } from '@/types/matching';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobPageHeader } from '@/components/blob';
import { Check, Waves, Wind } from 'lucide-react';
import { clearMatchingStorage } from './storage';


const levelLabels: Record<Level, string> = { beginner: 'Débutant', intermediate: 'Intermédiaire', advanced: 'Confirmé', anytime: 'Peu importe' };
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
        // No local hint check — truth comes from the server session.
        const currentUser = await apiClient.me() as DashboardUser;

        // Rediriger les PRO vers leur dashboard
        if (currentUser.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }

        // Vérifier si le profil est complet avant d'accéder au matching
        const [profile, disciplines] = await Promise.all([
          apiClient.getProfile() as Promise<Partial<DashboardUser> & { displayName?: string | null; hasPhoto?: boolean }>,
          apiClient.getDisciplines().catch(() => []) as Promise<Array<{ sport: Sport; level: Level }>>,
        ]);

        const hasName = Boolean(profile?.displayName);
        const hasPhoto = Boolean(profile?.hasPhoto);
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
      } catch {
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
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <BackBar fallbackHref="/dashboard" tone="blobDark" />

      <div className="space-y-4">
        <BlobBadge variant="yellow" size="md">Étape 1/3</BlobBadge>
        <BlobPageHeader
          title="Matching riders"
          subtitle="Choisis ton sport et ton niveau pour préparer une recherche adaptée à ta session."
        />
      </div>

      <BlobCard mode="white" className="motion-safe:hover:translate-y-0">
        <div className="space-y-6">
          <header className="border-b-2 border-blob-sand-deep pb-5 dark:border-white/10">
            <h2 className="text-xl font-black uppercase tracking-widest sm:text-2xl">Sport et niveau</h2>
            <p className="mt-2 text-sm leading-6 text-blob-black/70 dark:text-white/70">
              Sélectionne ton sport préféré et ton niveau pour cette session.
            </p>
          </header>

          <fieldset className="space-y-3">
            <legend className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/60 dark:text-white/60">
              Sport pratiqué
            </legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => selectSport('surf')}
              aria-pressed={chosenSport === 'surf'}
              className={`min-h-32 rounded-sm border-2 px-5 py-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 ${
                chosenSport === 'surf'
                  ? 'border-blob-black bg-blob-yellow text-blob-black dark:border-blob-yellow'
                  : 'border-blob-sand-deep bg-blob-sand text-blob-black hover:border-blob-black dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-white/60'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-current/25 bg-white/60 dark:bg-black/10">
                  <Waves aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-black uppercase tracking-widest">Surf</span>
                    {chosenSport === 'surf' && <Check size={18} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <p className="mt-2 text-sm leading-5 opacity-75">
                    Sessions douces, shortboard ou longboard : trouve un binôme à ton rythme.
                  </p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => selectSport('kitesurf')}
              aria-pressed={chosenSport === 'kitesurf'}
              className={`min-h-32 rounded-sm border-2 px-5 py-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 ${
                chosenSport === 'kitesurf'
                  ? 'border-blob-black bg-blob-yellow text-blob-black dark:border-blob-yellow'
                  : 'border-blob-sand-deep bg-blob-sand text-blob-black hover:border-blob-black dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-white/60'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-current/25 bg-white/60 dark:bg-black/10">
                  <Wind aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-black uppercase tracking-widest">Kitesurf</span>
                    {chosenSport === 'kitesurf' && <Check size={18} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <p className="mt-2 text-sm leading-5 opacity-75">
                    Sessions ventées et downwinds. Active ce mode pour ton aile préférée.
                  </p>
                </div>
              </div>
            </button>
          </div>
          </fieldset>

          {chosenSport && (
            <fieldset className="space-y-3">
              <legend className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/60 dark:text-white/60">
                Niveau {chosenSport === 'surf' ? 'surf' : 'kitesurf'}
              </legend>
              <p className="text-sm text-blob-black/64 dark:text-white/64">Ajuste ton niveau pour des matchs plus précis.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(['beginner','intermediate','advanced','anytime'] as Level[]).map((l) => {
                  const isSelected = chosenSport === 'surf' ? surfLevel === l : kiteLevel === l;
                  const onClick = chosenSport === 'surf' ? () => setSurfLevel(l) : () => setKiteLevel(l);
                  return (
                    <button
                      type="button"
                      key={l}
                      onClick={onClick}
                      aria-pressed={isSelected}
                      className={`min-h-12 rounded-sm border-2 px-3 py-3 text-sm font-black uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2 ${
                        isSelected
                          ? 'border-blob-black bg-blob-black text-white dark:border-blob-yellow dark:bg-blob-yellow dark:text-blob-black'
                          : 'border-blob-sand-deep bg-white text-blob-black hover:border-blob-black dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-white/60'
                      }`}
                    >
                      {levelLabels[l]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      </BlobCard>

      <BlobAlert variant="info" title="Sélection actuelle">
        {breadcrumb}
      </BlobAlert>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <BlobButton
                variant="outlineDark"
                size="md"
                onClick={() => {
                  setSurfLevel('');
                  setKiteLevel('');
                  setChosenSport(null);
                  clearMatchingStorage();
                }}
                className="w-full sm:w-auto"
              >
                Réinitialiser
              </BlobButton>
              <BlobButton
                size="md"
                disabled={!canContinue}
                onClick={() => {
                  if (!apiClient.getTokens()?.accessToken) {
                    router.push('/login');
                    return;
                  }
                  if (chosenSport === 'surf') {
                    try { localStorage.setItem(SPORT_KEY, 'surf'); localStorage.setItem(LEVEL_KEY, (surfLevel || 'beginner') as string); } catch {}
                    router.push(`/matching/date?sport=surf&level=${surfLevel || 'beginner'}`);
                  } else if (chosenSport === 'kitesurf') {
                    try { localStorage.setItem(SPORT_KEY, 'kitesurf'); localStorage.setItem(LEVEL_KEY, (kiteLevel || 'beginner') as string); } catch {}
                    router.push(`/matching/date?sport=kitesurf&level=${kiteLevel || 'beginner'}`);
                  }
                }}
                className="w-full sm:w-auto"
              >
                Continuer vers la date
              </BlobButton>
      </div>
    </div>
  );
}
