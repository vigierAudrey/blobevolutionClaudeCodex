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
        if (effSport === 'surf') { setSurfSelected(true); setChosenSport('surf'); if (effLevel) setSurfLevel(effLevel); }
        if (effSport === 'kitesurf') { setKiteSelected(true); setChosenSport('kitesurf'); if (effLevel) setKiteLevel(effLevel); }
        // Prefill from profile disciplines
        const discs = await apiClient.getDisciplines();
        const surf = discs.find(d => d.sport === 'surf');
        const kite = discs.find(d => d.sport === 'kitesurf');
        if (surf) { setSurfSelected(true); if (!surfLevel) setSurfLevel(surf.level as any); if (!chosenSport) setChosenSport('surf'); }
        if (kite) { setKiteSelected(true); if (!kiteLevel) setKiteLevel(kite.level as any); if (!chosenSport) setChosenSport('kitesurf'); }
        const count = (surf ? 1 : 0) + (kite ? 1 : 0);
        if (count === 1 && (surf || kite)) {
          const s = surf ? 'surf' : 'kitesurf';
          const l = (surf ? surf.level : kite!.level) as Level;
          try { localStorage.setItem(SPORT_KEY, s); localStorage.setItem(LEVEL_KEY, l); } catch {}
          const next = new URL(window.location.origin + '/matching/date');
          next.searchParams.set('sport', s);
          next.searchParams.set('level', l);
          window.location.href = next.toString();
        }
      } catch {}
    })();
  }, [chosenSport, kiteLevel, surfLevel]);

  const toggleSport = (s: Sport) => {
    if (s === 'surf') {
      const next = !surfSelected; setSurfSelected(next);
      if (next) { setChosenSport('surf'); if (!surfLevel) setSurfLevel('beginner'); }
      else if (chosenSport === 'surf') setChosenSport(kiteSelected ? 'kitesurf' : null);
    } else {
      const next = !kiteSelected; setKiteSelected(next);
      if (next) { setChosenSport('kitesurf'); if (!kiteLevel) setKiteLevel('beginner'); }
      else if (chosenSport === 'kitesurf') setChosenSport(surfSelected ? 'surf' : null);
    }
  };

  const canContinue = useMemo(() => {
    if (!chosenSport) return false;
    if (chosenSport === 'surf') return surfSelected && !!surfLevel;
    return kiteSelected && !!kiteLevel;
  }, [chosenSport, surfSelected, kiteSelected, surfLevel, kiteLevel]);

  const breadcrumb = useMemo(() => {
    const items: string[] = [];
    items.push(surfSelected ? `Surf ${surfLevel ? `(${levelLabels[surfLevel as Level]})` : ''}` : 'Surf —');
    items.push(kiteSelected ? `Kite ${kiteLevel ? `(${levelLabels[kiteLevel as Level]})` : ''}` : 'Kite —');
    items.push(`Utilisé: ${chosenSport ?? '—'}`);
    return items.join(' • ');
  }, [surfSelected, kiteSelected, surfLevel, kiteLevel, chosenSport]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />
      <div>
        <h1 className="text-2xl font-semibold">Matching</h1>
        <p className="text-sm text-muted-foreground">Choisis un ou deux sports et précise le niveau pour chacun. Un seul sport sera utilisé pour cette recherche.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1) Sélection des sports</CardTitle>
          <CardDescription>Active Surf et/ou Kitesurf, puis choisis les niveaux.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => toggleSport('surf')} aria-pressed={surfSelected} className={'rounded-md border px-4 py-6 text-center text-sm transition ' + (surfSelected ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')}>Surf</button>
            <button onClick={() => toggleSport('kitesurf')} aria-pressed={kiteSelected} className={'rounded-md border px-4 py-6 text-center text-sm transition ' + (kiteSelected ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')}>Kitesurf</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={!surfSelected ? 'opacity-50' : ''}>
              <div className="text-sm mb-1">Niveau Surf</div>
              <div className="grid grid-cols-3 gap-2">
                {(['beginner','intermediate','advanced'] as Level[]).map(l => (
                  <button key={l} disabled={!surfSelected} onClick={() => setSurfLevel(l)} aria-pressed={surfLevel === l} className={'rounded-md border px-2 py-2 text-xs transition disabled:opacity-50 ' + (surfLevel === l ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')}>{levelLabels[l]}</button>
                ))}
              </div>
            </div>
            <div className={!kiteSelected ? 'opacity-50' : ''}>
              <div className="text-sm mb-1">Niveau Kitesurf</div>
              <div className="grid grid-cols-3 gap-2">
                {(['beginner','intermediate','advanced'] as Level[]).map(l => (
                  <button key={l} disabled={!kiteSelected} onClick={() => setKiteLevel(l)} aria-pressed={kiteLevel === l} className={'rounded-md border px-2 py-2 text-xs transition disabled:opacity-50 ' + (kiteLevel === l ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')}>{levelLabels[l]}</button>
                ))}
              </div>
            </div>
          </div>
          {(surfSelected && kiteSelected) && (
            <div className="text-sm">
              <div className="mb-1">Sport utilisé pour ce matching</div>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-1">
                  <input type="radio" name="chosenSport" checked={chosenSport === 'surf'} onChange={()=>setChosenSport('surf')} /> Surf ({surfLevel ? levelLabels[surfLevel as Level] : 'niveau ?'})
                </label>
                <label className="inline-flex items-center gap-1">
                  <input type="radio" name="chosenSport" checked={chosenSport === 'kitesurf'} onChange={()=>setChosenSport('kitesurf')} /> Kitesurf ({kiteLevel ? levelLabels[kiteLevel as Level] : 'niveau ?'})
                </label>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Préférences</CardTitle>
          <CardDescription>Tu peux enregistrer ces niveaux dans ton profil.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="secondary"
            disabled={!surfSelected && !kiteSelected}
            onClick={async () => {
              const items: any[] = [];
              if (surfSelected && surfLevel) items.push({ sport: 'surf', level: surfLevel });
              if (kiteSelected && kiteLevel) items.push({ sport: 'kitesurf', level: kiteLevel });
              try {
                await apiClient.setDisciplines(items);
                toast('Préférences enregistrées', 'success');
              } catch (e: any) {
                toast(e?.message || 'Erreur lors de l’enregistrement', 'error');
              }
            }}
          >
            Enregistrer comme préférence
          </Button>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <input id="wantsLesson" type="checkbox" onChange={async (e)=>{
              try {
                const sport = chosenSport || 'surf';
                await apiClient.updateProfile({ wantsLesson: e.target.checked, lessonSport: sport });
                toast(e.target.checked ? 'Demande de cours activée' : 'Demande de cours désactivée', 'success');
              } catch (err: any) {
                toast(err?.message || 'Erreur mise à jour', 'error');
              }
            }} />
            <label htmlFor="wantsLesson">Je veux un cours avec un pro</label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sélection actuelle</CardTitle>
          <CardDescription className="text-sm">{breadcrumb}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { setSurfSelected(false); setKiteSelected(false); setSurfLevel(''); setKiteLevel(''); setChosenSport(null); try { localStorage.removeItem(SPORT_KEY); localStorage.removeItem(LEVEL_KEY); } catch {} }}>Réinitialiser</Button>
            <Button disabled={!canContinue} onClick={() => {
              const url = new URL(window.location.origin + '/matching/date');
              if (chosenSport === 'surf') {
                url.searchParams.set('sport', 'surf');
                url.searchParams.set('level', (surfLevel || 'beginner') as string);
                try { localStorage.setItem(SPORT_KEY, 'surf'); localStorage.setItem(LEVEL_KEY, (surfLevel || 'beginner') as string); } catch {}
              } else if (chosenSport === 'kitesurf') {
                url.searchParams.set('sport', 'kitesurf');
                url.searchParams.set('level', (kiteLevel || 'beginner') as string);
                try { localStorage.setItem(SPORT_KEY, 'kitesurf'); localStorage.setItem(LEVEL_KEY, (kiteLevel || 'beginner') as string); } catch {}
              }
              window.location.href = url.toString();
            }}>Continuer</Button>
            <Button variant="secondary" onClick={async ()=>{
              try {
                const sport = chosenSport || 'surf';
                await apiClient.updateProfile({ wantsLesson: true, lessonSport: sport });
                toast('Ta demande de cours est visible par les pros.', 'success');
              } catch (e: any) {
                toast(e?.message || 'Erreur', 'error');
              }
            }}>Faire appel à un pro</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
