"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { BackBar } from '../../components/BackBar';
import { Button } from '../../components/ui/button';

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';
type Partner = 'ALL' | 'WOMEN' | 'MEN';

const sportLabels: Record<Sport, string> = { surf: 'Surf', kitesurf: 'Kitesurf' };
const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
};
const partnerLabels: Record<Partner, string> = {
  ALL: 'Peu importe',
  WOMEN: 'Uniquement les femmes',
  MEN: 'Uniquement les hommes',
};

const SPORT_KEY = 'matching.sport';
const LEVEL_KEY = 'matching.level';
const PARTNER_KEY = 'matching.partner';

export default function MatchingPage() {
  const router = useRouter();
  const [sport, setSport] = useState<Sport | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);

  // Init from URL or localStorage
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const qsSport = url.searchParams.get('sport') as Sport | null;
      const qsLevel = url.searchParams.get('level') as Level | null;
      const qsPartner = url.searchParams.get('partner') as Partner | null;
      const lsSport = (localStorage.getItem(SPORT_KEY) as Sport | null) || null;
      const lsLevel = (localStorage.getItem(LEVEL_KEY) as Level | null) || null;
      const lsPartner = (localStorage.getItem(PARTNER_KEY) as Partner | null) || null;
      setSport(qsSport || lsSport);
      setLevel(qsLevel || lsLevel);
      setPartner(qsPartner || lsPartner || 'ALL');
    } catch {}
  }, []);

  const setSportPersist = (s: Sport) => {
    setSport(s);
    try { localStorage.setItem(SPORT_KEY, s); } catch {}
    const url = new URL(window.location.href);
    url.searchParams.set('sport', s);
    url.searchParams.delete('level');
    window.history.replaceState(null, '', url.toString());
    setLevel(null);
  };

  const setLevelPersist = (l: Level) => {
    setLevel(l);
    try { localStorage.setItem(LEVEL_KEY, l); } catch {}
    const url = new URL(window.location.href);
    if (sport) url.searchParams.set('sport', sport);
    url.searchParams.set('level', l);
    window.history.replaceState(null, '', url.toString());
  };

  const setPartnerPersist = (p: Partner) => {
    setPartner(p);
    try { localStorage.setItem(PARTNER_KEY, p); } catch {}
    const url = new URL(window.location.href);
    if (sport) url.searchParams.set('sport', sport);
    if (level) url.searchParams.set('level', level);
    url.searchParams.set('partner', p);
    window.history.replaceState(null, '', url.toString());
  };

  const resetAll = () => {
    setSport(null); setLevel(null); setPartner('ALL');
    try { localStorage.removeItem(SPORT_KEY); localStorage.removeItem(LEVEL_KEY); localStorage.removeItem(PARTNER_KEY); } catch {}
    const url = new URL(window.location.href);
    url.searchParams.delete('sport');
    url.searchParams.delete('level');
    url.searchParams.delete('partner');
    window.history.replaceState(null, '', url.toString());
  };

  const breadcrumb = useMemo(() => {
    const partnerShort = partner ? (partner === 'ALL' ? 'Peu importe' : partner === 'WOMEN' ? 'Femmes' : 'Hommes') : '—';
    const items = [sport ? sportLabels[sport] : '—', level ? levelLabels[level] : '—', partnerShort];
    return items.join(' > ');
  }, [sport, level]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />

      <div>
        <h1 className="text-2xl font-semibold">Matching</h1>
        <p className="text-sm text-muted-foreground">Sélectionne ton sport puis ton niveau. Nous afficherons des partenaires adaptés.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1) Choisis ton sport</CardTitle>
          <CardDescription>Surf ou Kitesurf</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {(['surf', 'kitesurf'] as Sport[]).map((s) => (
              <button
                key={s}
                onClick={() => setSportPersist(s)}
                aria-pressed={sport === s}
                className={
                  'rounded-md border px-4 py-8 text-center text-sm transition ' +
                  (sport === s ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')
                }
              >
                {sportLabels[s]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2) Ton niveau</CardTitle>
          <CardDescription>Débutant / Intermédiaire / Confirmé</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['beginner', 'intermediate', 'advanced'] as Level[]).map((l) => (
              <button
                key={l}
                onClick={() => setLevelPersist(l)}
                disabled={!sport}
                aria-pressed={level === l}
                className={
                  'rounded-md border px-4 py-3 text-sm transition disabled:opacity-50 ' +
                  (level === l ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')
                }
              >
                {levelLabels[l]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3) Choix du partenaire</CardTitle>
          <CardDescription>Peu importe / Femmes / Hommes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['ALL', 'WOMEN', 'MEN'] as Partner[]).map((p) => (
              <button
                key={p}
                disabled={!sport || !level}
                onClick={() => setPartnerPersist(p)}
                aria-pressed={partner === p}
                className={
                  'rounded-md border px-4 py-3 text-sm transition disabled:opacity-50 ' +
                  (partner === p ? 'border-primary ring-2 ring-primary' : 'border-input hover:bg-accent')
                }
              >
                {partnerLabels[p]}
              </button>
            ))}
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
            <Button variant="outline" onClick={resetAll}>Réinitialiser</Button>
            <Button
              disabled={!sport || !level}
              onClick={() => {
                const url = new URL(window.location.origin + '/matching/location');
                if (sport) url.searchParams.set('sport', sport);
                if (level) url.searchParams.set('level', level);
                if (partner) url.searchParams.set('partner', partner);
                window.location.href = url.toString();
              }}
            >
              Continuer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
