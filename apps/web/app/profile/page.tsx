"use client";
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Button } from '../../components/ui/button';
import { apiClient } from '../../lib/apiClient';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { useToast } from '../../components/ui/toast';
import { Spinner } from '../../components/ui/spinner';
import { apiClient as client } from '../../lib/apiClient';

type Sex = 'Femme' | 'Homme' | 'Autre' | 'Ne pas préciser';

export default function ProfilePage() {
  const router = useRouter();
  const toast = useToast();
  // Photo upload + preview
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    const url = URL.createObjectURL(f);
    setPhotoUrl(url);
  };

  // Form fields
  const [sex, setSex] = useState<Sex>('Femme');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [/*deprecatedPartnerPref*/] = useState<string>('ALL');
  const [/*deprecatedMaxDistance*/] = useState<number>(20);
  const [emailNotif, setEmailNotif] = useState<boolean>(false);
  const [wantsLesson, setWantsLesson] = useState<boolean>(false);
  const [lessonSport, setLessonSport] = useState<'surf'|'kitesurf'>('surf');

  useEffect(() => {
    // Charger le profil existant
    apiClient
      .getProfile()
      .then((p) => {
        setDisplayName(p.displayName ?? '');
        setBio(p.bio ?? '');
        // Map enums -> labels UI
        setSex(
          p.sex === 'FEMALE' ? 'Femme' : p.sex === 'MALE' ? 'Homme' : p.sex === 'OTHER' ? 'Autre' : 'Ne pas préciser',
        );
        // Partner preference & distance moved to matching flow – no longer editable here
        setEmailNotif(!!p.emailNotif);
        setWantsLesson(!!(p as any).wantsLesson);
        setLessonSport((p as any).lessonSport === 'kitesurf' ? 'kitesurf' : 'surf');
        setPhotoUrl(p.photoUrl ?? null);
      })
      .catch(() => {
        // si non authentifié
        router.replace('/login');
      });
  }, [router]);

  // Disciplines state
  const [surfLevel, setSurfLevel] = useState<'' | 'beginner' | 'intermediate' | 'advanced'>('');
  const [kiteLevel, setKiteLevel] = useState<'' | 'beginner' | 'intermediate' | 'advanced'>('');

  useEffect(() => {
    client.getDisciplines().then((items) => {
      const surf = items.find((d) => d.sport === 'surf');
      const kite = items.find((d) => d.sport === 'kitesurf');
      setSurfLevel((surf?.level as any) || '');
      setKiteLevel((kite?.level as any) || '');
    }).catch(() => {});
  }, []);

  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Map UI -> enums API
    const sexEnum = sex === 'Femme' ? 'FEMALE' : sex === 'Homme' ? 'MALE' : sex === 'Autre' ? 'OTHER' : 'UNSPECIFIED';
    const body = {
      displayName: displayName || undefined,
      bio: bio || undefined,
      sex: sexEnum,
      // partnerPref and maxDistance moved to matching flow
      emailNotif,
      wantsLesson,
      lessonSport,
      photoUrl: photoUrl || undefined,
    };
    try {
      setSaving(true);
      // If there is a new photo file, upload it first
      if (photoFile) {
        const contentType = photoFile.type || 'image/jpeg';
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/profile/photo/upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiClient.getTokens()?.accessToken || ''}` },
          body: JSON.stringify({ contentType }),
        });
        if (!res.ok) throw new Error('Impossible de préparer le téléversement');
        const data = await res.json();
        const uploadUrl = data.uploadUrl as string;
        const finalUrl = data.fileUrl as string | undefined;
        // Upload direct to S3/MinIO
        const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: photoFile });
        if (!put.ok) throw new Error('Échec de l’upload');
        if (finalUrl) body.photoUrl = finalUrl;
      }

      await apiClient.updateProfile(body);
      toast('Profil sauvegardé', 'success');
    } catch (e: any) {
      toast(e?.message || 'Erreur lors de la sauvegarde', 'error');
    }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BackBar fallbackHref="/dashboard" />
      <div className="text-center space-y-1">
        <h1 className="text-2xl sm:text-3xl font-semibold">Modifier mon Profil 🏄‍♀️</h1>
        <p className="text-sm text-muted-foreground">Personnalise ton profil et choisis tes préférences de session.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Top grid: photo + sexe | nom + présentation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">📸 Charger sa photo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-xl border-2 border-rose-300 p-1">
                  <div className="h-48 w-36 sm:h-56 sm:w-44 overflow-hidden rounded-lg bg-muted flex items-center justify-center">
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrl} alt="Photo profil" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Aperçu</span>
                    )}
                  </div>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickPhoto}
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground hover:file:bg-secondary/80"
                />
                <div className="w-full">
                  <Label htmlFor="sex">Sexe</Label>
                  <select
                    id="sex"
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={sex}
                    onChange={(e) => setSex(e.target.value as Sex)}
                  >
                    <option>Femme</option>
                    <option>Homme</option>
                    <option>Autre</option>
                    <option>Ne pas préciser</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">📌 Nom à afficher dans le Matching</CardTitle>
              <CardDescription>Ce nom sera visible par tes partenaires potentiels lors des sessions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Exemple : Blobmama" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <div className="space-y-2">
                <Label htmlFor="bio">Ta présentation</Label>
                <Textarea
                  id="bio"
                  placeholder={
                    'Exemple : Je surf depuis trois ans et je suis plutôt shortboard. Je suis une lève-tôt, je préfère les sessions matinales. Maman à mi-temps, une autre BlobMama ici pour aller surfer ?'
                  }
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Disciplines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mes disciplines</CardTitle>
            <CardDescription>Sélectionne ton niveau pour chaque sport (tu peux choisir les deux)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Surf</Label>
                <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={surfLevel} onChange={(e)=>setSurfLevel(e.target.value as any)}>
                  <option value="">— Aucun —</option>
                  <option value="beginner">Débutant</option>
                  <option value="intermediate">Intermédiaire</option>
                  <option value="advanced">Confirmé</option>
                </select>
              </div>
              <div>
                <Label>Kitesurf</Label>
                <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={kiteLevel} onChange={(e)=>setKiteLevel(e.target.value as any)}>
                  <option value="">— Aucun —</option>
                  <option value="beginner">Débutant</option>
                  <option value="intermediate">Intermédiaire</option>
                  <option value="advanced">Confirmé</option>
                </select>
              </div>
            </div>
            <div>
              <Button type="button" variant="secondary" onClick={async ()=>{
                const items: any[] = [];
                if (surfLevel) items.push({ sport: 'surf', level: surfLevel });
                if (kiteLevel) items.push({ sport: 'kitesurf', level: kiteLevel });
                try {
                  await client.setDisciplines(items as any);
                  toast('Disciplines enregistrées', 'success');
                } catch (e: any) {
                  toast(e?.message || 'Erreur enregistrement disciplines', 'error');
                }
              }}>Enregistrer mes disciplines</Button>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Le choix du partenaire et la distance se font désormais dans le flux Matching pour éviter toute confusion.
            </p>

            <div className="flex items-center gap-2">
              <input id="emailNotif" type="checkbox" checked={emailNotif} onChange={(e) => setEmailNotif(e.target.checked)} />
              <Label htmlFor="emailNotif" className="!m-0">
                Recevoir des emails lorsqu’un partenaire cherche à me joindre
              </Label>
            </div>

            <div className="flex items-start gap-2">
              <input id="wantsLesson" type="checkbox" checked={wantsLesson} onChange={(e)=>setWantsLesson(e.target.checked)} />
              <div>
                <Label htmlFor="wantsLesson" className="!m-0">Je veux un cours</Label>
                <div className="mt-2">
                  <Label className="mr-2">Sport</Label>
                  <select className="h-9 rounded-md border px-2" value={lessonSport} onChange={(e)=> setLessonSport(e.target.value as any)}>
                    <option value="surf">Surf</option>
                    <option value="kitesurf">Kitesurf</option>
                  </select>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Les pros à proximité verront ta demande sur la BloboMap.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
            {saving ? (
              <span className="inline-flex items-center gap-2"><Spinner /> Enregistrement…</span>
            ) : (
              'Enregistrer'
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
