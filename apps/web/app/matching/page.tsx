"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { Button } from '../../components/ui/button';
import { apiClient } from '../../lib/apiClient';
import { useToast } from '../../components/ui/toast';

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';

const levelLabels: Record<Level, string> = { beginner: 'Débutant', intermediate: 'Intermédiaire', advanced: 'Confirmé' };
const SPORT_KEY = 'matching.sport';
const LEVEL_KEY = 'matching.level';

export default function MatchingPage() {
  const router = useRouter();
  const toast = useToast();
  const [surfSelected, setSurfSelected] = useState<boolean>(false);
  const [kiteSelected, setKiteSelected] = useState<boolean>(false);
  const [surfLevel, setSurfLevel] = useState<Level | ''>('');
  const [kiteLevel, setKiteLevel] = useState<Level | ''>('');
  const [chosenSport, setChosenSport] = useState<Sport | null>(null);
  const [wantsLesson, setWantsLesson] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        // Prefill from URL/localStorage
        const url = new URL(window.location.href);
        const qsSport = url.searchParams.get('sport') as Sport | null;
        const qsLevel = url.searchParams.get('level') as Level | null;
        const lsSport = (localStorage.getItem(SPORT_KEY) as Sport | null) || null;
        const lsLevel = (localStorage.getItem(LEVEL_KEY) as Level | null) || null;
        const effSport = qsSport || lsSport;
        const effLevel = (qsLevel || lsLevel) as Level | null;

        if (effSport === 'surf') {
          setSurfSelected(true);
          setChosenSport('surf');
          if (effLevel) setSurfLevel(effLevel);
        }
        if (effSport === 'kitesurf') {
          setKiteSelected(true);
          setChosenSport('kitesurf');
          if (effLevel) setKiteLevel(effLevel);
        }

        // Prefill from profile disciplines only if nothing was set from URL/localStorage
        if (!effSport) {
          const discs = await apiClient.getDisciplines();
          const surf = discs.find(d => d.sport === 'surf');
          const kite = discs.find(d => d.sport === 'kitesurf');

          if (surf) {
            setSurfSelected(true);
            setSurfLevel(surf.level as any);
            if (!kite) setChosenSport('surf');
          }
          if (kite) {
            setKiteSelected(true);
            setKiteLevel(kite.level as any);
            if (!surf) setChosenSport('kitesurf');
          }

          // Don't auto-redirect - let user choose explicitly to avoid infinite loops
        }
      } catch {}
    })();
  }, []); // Remove problematic dependencies to prevent infinite loop

  const selectSport = (s: Sport) => {
    // Directly set the chosen sport and activate it
    setChosenSport(s);
    if (s === 'surf') {
      setSurfSelected(true);
      setKiteSelected(false);
      if (!surfLevel) setSurfLevel('beginner');
      setKiteLevel(''); // Clear kite level when surf is selected
    } else {
      setKiteSelected(true);
      setSurfSelected(false);
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
    const lessonIcon = wantsLesson ? ' 🎓' : '';
    return `${chosenSport === 'surf' ? 'Surf' : 'Kitesurf'} - ${levelText}${lessonIcon}`;
  }, [chosenSport, surfLevel, kiteLevel, wantsLesson]);

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Options pour cette session</CardTitle>
          <CardDescription>Coche si tu souhaites un cours avec un pro pour cette session.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm">
            <input id="wantsLesson" type="checkbox" checked={wantsLesson} onChange={async (e)=>{
              const checked = e.target.checked;
              setWantsLesson(checked);
              try {
                const sport = chosenSport || 'surf';
                await apiClient.updateProfile({ wantsLesson: checked, lessonSport: sport });
                toast(checked ? 'Demande de cours activée' : 'Demande de cours désactivée', 'success');
              } catch (err: any) {
                toast(err?.message || 'Erreur mise à jour', 'error');
              }
            }} />
            <label htmlFor="wantsLesson" className="flex items-center gap-1">
              <span>🎓</span>
              Je veux un cours avec un pro
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ton choix pour ce matching</CardTitle>
          <CardDescription className="text-sm">{breadcrumb}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { setSurfSelected(false); setKiteSelected(false); setSurfLevel(''); setKiteLevel(''); setChosenSport(null); try { localStorage.removeItem(SPORT_KEY); localStorage.removeItem(LEVEL_KEY); } catch {} }}>Changer de sport</Button>
            <Button disabled={!canContinue} onClick={() => {
              console.log('Continuer clicked:', { canContinue, chosenSport, surfLevel, kiteLevel });
              if (chosenSport === 'surf') {
                console.log('Navigating to surf page...');
                try { localStorage.setItem(SPORT_KEY, 'surf'); localStorage.setItem(LEVEL_KEY, (surfLevel || 'beginner') as string); } catch {}
                window.location.href = `/matching/date?sport=surf&level=${surfLevel || 'beginner'}`;
              } else if (chosenSport === 'kitesurf') {
                console.log('Navigating to kitesurf page...');
                try { localStorage.setItem(SPORT_KEY, 'kitesurf'); localStorage.setItem(LEVEL_KEY, (kiteLevel || 'beginner') as string); } catch {}
                window.location.href = `/matching/date?sport=kitesurf&level=${kiteLevel || 'beginner'}`;
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
