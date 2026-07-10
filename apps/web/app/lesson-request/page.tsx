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
import { CalendarDays, GraduationCap, Locate, MapPin, Pencil, Sparkles, Trash2, Users } from 'lucide-react';

export const dynamic = 'force-dynamic';

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';

const sportLabels: Record<Sport, string> = { surf: 'Surf', kitesurf: 'Kitesurf' };
const sportEmoji: Record<Sport, string> = { surf: '🏄', kitesurf: '🪁' };
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
  lessonLat?: number | null;
  lessonLng?: number | null;
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
  const [lessonLat, setLessonLat] = useState<number | null>(null);
  const [lessonLng, setLessonLng] = useState<number | null>(null);
  const [geolocLoading, setGeolocLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  // Snapshot of the saved request (for the recap card)
  const [savedRequest, setSavedRequest] = useState<{
    sport: Sport | null;
    level: Level | null;
    date: string;
    place: string;
    studentCount: number;
  } | null>(null);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/lesson-request`);
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await apiClient.getProfile();
        const hasActive = !!profile.wantsLesson;
        setWantsLesson(hasActive);

        const sport = (profile.lessonSport as Sport) || null;
        const level = (profile.lessonLevel as Level) || null;
        // Une date passée (demande expirée ou en attente d'expiration) est vidée :
        // le serveur la refuserait (400) et l'input a min=aujourd'hui.
        const storedDate = profile.lessonDate
          ? new Date(profile.lessonDate).toISOString().slice(0, 10)
          : '';
        const date = storedDate && storedDate < new Date().toISOString().slice(0, 10) ? '' : storedDate;
        const place = profile.lessonPlace || '';
        const studentCount =
          typeof profile.lessonStudentCount === 'number' && profile.lessonStudentCount > 0
            ? profile.lessonStudentCount
            : 1;

        setLessonSport(sport);
        setLessonLevel(level);
        setLessonDate(date);
        setLessonPlace(place);
        setLessonStudentCount(studentCount);
        const lat = typeof profile.lessonLat === 'number' ? profile.lessonLat : null;
        const lng = typeof profile.lessonLng === 'number' ? profile.lessonLng : null;
        setLessonLat(lat);
        setLessonLng(lng);

        if (hasActive) {
          setSavedRequest({ sport, level, date, place, studentCount });
        }
      } catch (err) {
        const code = typeof (err as { code?: unknown })?.code === 'string'
          ? (err as { code: string }).code : null;
        const status = typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status : null;
        if (code === 'SESSION_EXPIRED' || status === 401) {
          router.replace('/login');
          return;
        }
        // Non-auth error (network, server) — don't redirect to login.
        console.error('Error loading lesson request profile:', err);
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
    if (wantsLesson && (lessonLat == null || lessonLng == null)) {
      toast('Capture ta position GPS pour que ta demande apparaisse sur la carte', 'error');
      return;
    }

    try {
      setSaving(true);

      const payload: LessonPayload = { wantsLesson };

      if (wantsLesson) {
        payload.lessonSport = lessonSport ?? null;
        payload.lessonLevel = lessonLevel ?? null;
        // null explicite : clé absente = « ne pas toucher » côté API, or vider le
        // champ date en édition doit bien effacer la date en DB.
        payload.lessonDate = lessonDate || null;
        payload.lessonPlace = lessonPlace || undefined;
        payload.lessonStudentCount = Math.max(1, Math.min(6, lessonStudentCount || 1));
        payload.lessonLat = lessonLat ?? null;
        payload.lessonLng = lessonLng ?? null;
      }

      await apiClient.updateProfile(payload);

      setSavedRequest({
        sport: lessonSport,
        level: lessonLevel,
        date: lessonDate,
        place: lessonPlace,
        studentCount: Math.max(1, Math.min(6, lessonStudentCount || 1)),
      });
      setEditing(false);

      toast('Demande de cours enregistrée !', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast(message || 'Erreur lors de la sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleting(true);
      await apiClient.updateProfile({
        wantsLesson: false,
        lessonSport: null,
        lessonLevel: null,
        lessonDate: null,
        lessonPlace: null,
        lessonStudentCount: null,
      });

      setWantsLesson(false);
      setLessonSport(null);
      setLessonLevel(null);
      setLessonDate('');
      setLessonPlace('');
      setLessonStudentCount(1);
      setLessonLat(null);
      setLessonLng(null);
      setSavedRequest(null);
      setEditing(false);

      toast('Demande de cours supprimée', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : null;
      toast(message || 'Erreur lors de la suppression', 'error');
    } finally {
      setDeleting(false);
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

  // --- Recap card (demande active, pas en mode édition) ---
  if (savedRequest && !editing) {
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

        {/* Recap card */}
        <Card className="border-2 border-green-200 bg-green-50/60 shadow-sm dark:border-green-800 dark:bg-green-950/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-green-200 dark:ring-green-800" />
              <CardTitle className="text-base text-green-800 dark:text-green-300">
                Ta demande est en ligne
              </CardTitle>
            </div>
            <CardDescription className="text-green-700 dark:text-green-400">
              Les professionnels sur la BloboMap Pro peuvent voir ta fiche et te contacter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Détails */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {savedRequest.sport && (
                <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2.5 text-sm dark:bg-slate-900/60">
                  <span className="text-base">{sportEmoji[savedRequest.sport]}</span>
                  <div>
                    <p className="text-xs text-muted-foreground">Sport</p>
                    <p className="font-medium">{sportLabels[savedRequest.sport]}</p>
                  </div>
                </div>
              )}

              {savedRequest.level && (
                <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2.5 text-sm dark:bg-slate-900/60">
                  <GraduationCap className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Niveau</p>
                    <p className="font-medium">{levelLabels[savedRequest.level]}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2.5 text-sm dark:bg-slate-900/60">
                <Users className="w-4 h-4 text-blue-500 shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Participants</p>
                  <p className="font-medium">
                    {savedRequest.studentCount} élève{savedRequest.studentCount > 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              {savedRequest.date && (
                <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2.5 text-sm dark:bg-slate-900/60">
                  <CalendarDays className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Date souhaitée</p>
                    <p className="font-medium">
                      {new Date(savedRequest.date + 'T12:00:00').toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
              )}

              {savedRequest.place && (
                <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2.5 text-sm dark:bg-slate-900/60 sm:col-span-2">
                  <MapPin className="w-4 h-4 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Lieu / Spot</p>
                    <p className="font-medium">{savedRequest.place}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(true)}
                className="w-full sm:w-auto gap-2"
              >
                <Pencil className="w-4 h-4" />
                Modifier
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
                className="w-full sm:w-auto gap-2"
              >
                {deleting ? (
                  <>
                    <Spinner /> Suppression...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Supprimer la demande
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Formulaire (création ou modification) ---
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
          ℹ️ Si tu as matché avec d&apos;autres riders, publie <strong>une seule demande commune</strong> pour éviter les doublons.
        </p>
        <p className="text-xs opacity-80">
          Partage le lien <span className="font-semibold break-all">{shareUrl || '/lesson-request'}</span> au sein de ton groupe.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card className="border-2 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-white text-slate-700">
                {editing ? 'Modification' : 'Étape unique'}
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

                {/* Géolocalisation du spot de cours */}
                <div className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">Position GPS du spot</p>
                      <p className="text-xs text-muted-foreground">
                        Permet aux pros de voir ta demande sur la carte
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={geolocLoading}
                      onClick={() => {
                        if (!navigator.geolocation) {
                          toast('Géolocalisation non supportée par ce navigateur', 'error');
                          return;
                        }
                        setGeolocLoading(true);
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            setLessonLat(pos.coords.latitude);
                            setLessonLng(pos.coords.longitude);
                            setGeolocLoading(false);
                          },
                          () => {
                            toast('Impossible d\'obtenir la position. Autorise la géolocalisation.', 'error');
                            setGeolocLoading(false);
                          },
                          { enableHighAccuracy: true, timeout: 10000 },
                        );
                      }}
                      className="gap-2 shrink-0"
                    >
                      <Locate className="w-4 h-4" />
                      {geolocLoading ? 'Localisation…' : 'Ma position actuelle'}
                    </Button>
                  </div>
                  {lessonLat != null && lessonLng != null ? (
                    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                      <MapPin className="w-3 h-3 shrink-0" />
                      Position capturée — le pin apparaîtra sur la BloboMap Pro
                      <button
                        type="button"
                        onClick={() => { setLessonLat(null); setLessonLng(null); }}
                        className="ml-auto text-muted-foreground hover:text-destructive underline-offset-2 hover:underline"
                      >
                        Effacer
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      ⚠️ Sans position GPS, ta demande ne sera pas visible sur la carte des pros.
                    </p>
                  )}
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
            onClick={() => editing ? setEditing(false) : router.push('/dashboard')}
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
