"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { BackBar } from '../../components/BackBar';
import { apiClient } from '../../lib/apiClient';
import { useToast } from '../../components/ui/toast';
import { Spinner } from '../../components/ui/spinner';
import { Badge } from '../../components/ui/badge';
import { Sparkles, GraduationCap } from 'lucide-react';

export const dynamic = 'force-dynamic';

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';

const sportLabels: Record<Sport, string> = { surf: 'Surf', kitesurf: 'Kitesurf' };
const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
};

type LessonPayload = {
  wantsLesson: boolean;
  lessonSport?: Sport | null;
  lessonLevel?: Level | null;
  lessonDate?: string | null;
  lessonPlace?: string | null;
  lessonStudentCount?: number | null;
};

export default function LessonRequestPage() {
  const router = useRouter();
  const toast = useToast();

  const [wantsLesson, setWantsLesson] = useState(false);
  const [lessonSport, setLessonSport] = useState<Sport | null>(null);
  const [lessonLevel, setLessonLevel] = useState<Level | null>(null);
  const [lessonDate, setLessonDate] = useState('');
  const [lessonPlace, setLessonPlace] = useState('');
  const [lessonStudentCount, setLessonStudentCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Charger les préférences actuelles
    const loadProfile = async () => {
      try {
        const profile = await apiClient.getProfile();
        setWantsLesson(profile.wantsLesson || false);
        setLessonSport((profile.lessonSport as Sport) || null);
        setLessonLevel((profile.lessonLevel as Level) || null);

        // Format date for input[type="date"]
        if (profile.lessonDate) {
          const date = new Date(profile.lessonDate);
          setLessonDate(date.toISOString().slice(0, 10));
        }

        setLessonPlace(profile.lessonPlace || '');
        setLessonStudentCount(
          typeof profile.lessonStudentCount === 'number' && profile.lessonStudentCount > 0
            ? profile.lessonStudentCount
            : 1
        );
      } catch (err) {
        console.error('Error loading profile:', err);
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (wantsLesson && (!lessonSport || !lessonLevel)) {
      toast('Veuillez choisir un sport et un niveau', 'error');
      return;
    }
    if (wantsLesson && (!lessonStudentCount || lessonStudentCount < 1 || lessonStudentCount > 6)) {
      toast('Indique un nombre de participants entre 1 et 6', 'error');
      return;
    }

    try {
      setSaving(true);

      const payload: LessonPayload = {
        wantsLesson,
      };

      if (wantsLesson) {
        payload.lessonSport = lessonSport ?? null;
        payload.lessonLevel = lessonLevel ?? null;
        payload.lessonDate = lessonDate || undefined;
        payload.lessonPlace = lessonPlace || undefined;
        payload.lessonStudentCount = Math.max(1, Math.min(6, lessonStudentCount || 1));
      } else {
        // Clear all lesson data when disabling
        payload.lessonSport = null;
        payload.lessonLevel = null;
        payload.lessonDate = null;
        payload.lessonPlace = null;
        payload.lessonStudentCount = null;
      }

      await apiClient.updateProfile(payload);
      toast(
        wantsLesson
          ? 'Demande de cours enregistrée ! Les pros peuvent maintenant vous voir sur la BloboMap.'
          : 'Demande de cours désactivée',
        'success'
      );

      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast(message || 'Erreur lors de la sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <BackBar fallbackHref="/dashboard" />
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/dashboard" />

      {/* Page Header */}
      <div className="flex items-center gap-3 pb-2 border-b">
        <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
          <GraduationCap className="w-5 h-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Publie ta demande de cours</h1>
            <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
              <Sparkles className="w-3 h-3 mr-1" />
              Cours privés
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">Les moniteurs de la BloboMap Pro peuvent te contacter directement</p>
        </div>
      </div>

      <div className="rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 space-y-2">
        <p>
          ℹ️ Si tu as matché avec d’autres riders, publie <strong>une seule demande commune</strong> pour éviter les doublons.
        </p>
        <p className="text-xs opacity-80">
          Partage le lien <span className="font-semibold break-all">http://localhost:3002/lesson-request</span> au sein de ton groupe.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card className="border-2 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-white text-slate-700">
                Étape unique
              </Badge>
              <CardTitle className="text-xl">Paramètres de la demande</CardTitle>
            </div>
            <CardDescription>
              Les professionnels verront cette fiche et pourront te contacter directement sur la messagerie.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
              <input
                id="wantsLesson"
                type="checkbox"
                checked={wantsLesson}
                onChange={(e) => setWantsLesson(e.target.checked)}
                className="w-5 h-5"
              />
              <label htmlFor="wantsLesson" className="flex items-center gap-2 text-sm font-medium">
                <GraduationCap className="w-4 h-4 text-blue-600" />
                Je cherche un cours avec un professionnel
              </label>
            </div>

            {wantsLesson && (
              <div className="space-y-4 pt-2">
                <div className="p-3 bg-blue-50 rounded text-xs text-blue-800">
                  Pour éviter les doublons, décidez quel rider soumettra cette demande et renseignez le nombre total de participants (binôme, trio, etc.).
                </div>
                <div>
                  <Label htmlFor="sport" className="mb-2 block">
                    Sport <span className="text-red-500">*</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    {(['surf', 'kitesurf'] as Sport[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setLessonSport(s)}
                        className={`rounded-2xl border-2 px-4 py-4 text-sm font-medium transition ${
                          lessonSport === s
                            ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-200'
                            : 'border-input hover:border-blue-200'
                        }`}
                      >
                        {s === 'surf' ? '🏄' : '🪁'} {sportLabels[s]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="students" className="mb-2 block">
                    Nombre d&apos;élèves <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="students"
                      type="number"
                      min={1}
                      max={6}
                      value={lessonStudentCount}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (!Number.isFinite(next)) {
                          setLessonStudentCount(1);
                          return;
                        }
                        setLessonStudentCount(Math.max(1, Math.min(6, Math.trunc(next))));
                      }}
                      className="w-24"
                    />
                    <p className="text-xs text-muted-foreground">
                      Ex. 1 = toi seul, 2 = binôme, 3+ = petit groupe (max 6).
                    </p>
                  </div>
                </div>

                <div>
                  <Label htmlFor="level" className="mb-2 block">
                    Niveau <span className="text-red-500">*</span>
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['beginner', 'intermediate', 'advanced'] as Level[]).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLessonLevel(l)}
                        className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
                          lessonLevel === l
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input hover:bg-accent'
                        }`}
                      >
                        {levelLabels[l]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="date" className="mb-2 block">
                    Date souhaitée (optionnel)
                  </Label>
                  <Input
                    id="date"
                    type="date"
                    value={lessonDate}
                    onChange={(e) => setLessonDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                  />
                </div>

                <div>
                  <Label htmlFor="place" className="mb-2 block">
                    Lieu / Spot (optionnel)
                  </Label>
                  <Input
                    id="place"
                    type="text"
                    placeholder="Ex: Hossegor, La Torche..."
                    value={lessonPlace}
                    onChange={(e) => setLessonPlace(e.target.value)}
                    maxLength={200}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Indique un lieu pour aider les pros à te trouver
                  </p>
                </div>

                <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-xs text-green-700 space-y-1">
                    <span className="block">
                      ✨ Une fois enregistrée, ta demande sera visible sur la BloboMap Pro et les professionnels pourront te contacter via la messagerie.
                    </span>
                    <span className="block">Un seul enregistrement par groupe suffit pour éviter les doublons.</span>
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/dashboard')}
            className="w-full sm:w-auto"
          >
            Annuler
          </Button>
          <Button type="submit" disabled={saving} className="w-full sm:w-auto">
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Spinner /> Enregistrement...
              </span>
            ) : (
              'Enregistrer'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
