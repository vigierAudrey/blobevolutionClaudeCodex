"use client";
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Button } from '../../components/ui/button';
import { apiClient } from '../../lib/apiClient';
import { useRouter } from 'next/navigation';

type Sex = 'Femme' | 'Homme' | 'Autre' | 'Ne pas préciser';
type PartnerPref = 'ALL' | 'WOMEN' | 'MEN';

export default function ProfilePage() {
  const router = useRouter();
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
  const [partnerPref, setPartnerPref] = useState<PartnerPref>('ALL');
  const [maxDistance, setMaxDistance] = useState<number>(20);
  const [emailNotif, setEmailNotif] = useState<boolean>(false);

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
        setPartnerPref(p.partnerPref as any);
        setMaxDistance(p.maxDistanceKm ?? 20);
        setEmailNotif(!!p.emailNotif);
        setPhotoUrl(p.photoUrl ?? null);
      })
      .catch(() => {
        // si non authentifié
        router.replace('/login');
      });
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Map UI -> enums API
    const sexEnum = sex === 'Femme' ? 'FEMALE' : sex === 'Homme' ? 'MALE' : sex === 'Autre' ? 'OTHER' : 'UNSPECIFIED';
    const body = {
      displayName: displayName || undefined,
      bio: bio || undefined,
      sex: sexEnum,
      partnerPref,
      maxDistanceKm: Number(maxDistance),
      emailNotif,
      photoUrl: photoUrl || undefined,
    };
    try {
      await apiClient.updateProfile(body);
      // TODO: upload photo file in next iteration (endpoint dédié)
      alert('Profil sauvegardé');
    } catch (e: any) {
      alert(e?.message || 'Erreur lors de la sauvegarde');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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

        {/* Session preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Préférences de Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="partnerPref">Sélection du partenaire</Label>
              <select
                id="partnerPref"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={partnerPref}
                onChange={(e) => setPartnerPref(e.target.value as PartnerPref)}
              >
                <option value="ALL">Peu importe</option>
                <option value="WOMEN">Uniquement les femmes</option>
                <option value="MEN">Uniquement les hommes</option>
              </select>
              <p className="text-xs text-amber-700">⚠️ Plus la sélection est restrictive, moins tu as de chance de trouver un partenaire.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="distance">Distance maximale (km)</Label>
              <div className="flex items-center gap-3">
                <input
                  id="distance"
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={maxDistance}
                  onChange={(e) => setMaxDistance(Number(e.target.value))}
                  className="w-full"
                />
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={maxDistance}
                  onChange={(e) => setMaxDistance(Number(e.target.value))}
                  className="w-20"
                />
              </div>
            </div>

            <p className="text-sm text-muted-foreground">⭐ La sélection de la tranche d’âge sera disponible dans une prochaine version.</p>

            <div className="flex items-center gap-2">
              <input id="emailNotif" type="checkbox" checked={emailNotif} onChange={(e) => setEmailNotif(e.target.checked)} />
              <Label htmlFor="emailNotif" className="!m-0">
                Recevoir des emails lorsqu’un partenaire cherche à me joindre
              </Label>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" className="w-full sm:w-auto">Enregistrer</Button>
        </div>
      </form>
    </div>
  );
}
