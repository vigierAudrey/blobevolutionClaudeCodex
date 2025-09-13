"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';

export default function ProProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [bio, setBio] = useState('');
  const [pricePerHour, setPricePerHour] = useState<number | ''>('');
  const [emailNotif, setEmailNotif] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) { router.replace('/login'); return; }
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${t.accessToken}` },
    })
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body?.error || 'Erreur chargement');
        setBusinessName(body.businessName || '');
        setBio(body.bio || '');
        setPricePerHour(typeof body.pricePerHour === 'number' ? body.pricePerHour : '');
        setEmailNotif(!!body.emailNotif);
        setPhotoUrl(body.photoUrl || null);
      })
      .catch((e) => setErr(e?.message || 'Erreur'))
      .finally(() => setLoading(false));
  }, [router]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPhotoUrl(URL.createObjectURL(f));
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const t = apiClient.getTokens();
      if (!t?.accessToken) throw new Error('Non connecté');

      let finalUrl = photoUrl || undefined;
      if (file) {
        const ct = file.type || 'image/jpeg';
        const p = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/photo/upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.accessToken}` },
          body: JSON.stringify({ contentType: ct }),
        });
        const data = await p.json();
        if (!p.ok) throw new Error(data?.error || 'Upload préparatoire impossible');
        await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': ct }, body: file });
        if (data.fileUrl) finalUrl = data.fileUrl;
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.accessToken}` },
        body: JSON.stringify({
          businessName: businessName || undefined,
          bio: bio || undefined,
          pricePerHour: typeof pricePerHour === 'number' ? pricePerHour : undefined,
          emailNotif,
          photoUrl: finalUrl,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Sauvegarde impossible');
      router.replace('/dashboard');
    } catch (e: any) {
      setErr(e?.message || 'Erreur');
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <BackBar fallbackHref="/dashboard" />
      <h1 className="text-2xl font-semibold mb-4">Profil Professionnel</h1>
      {loading ? (
        <p>Chargement…</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Mes infos pro</CardTitle>
            <CardDescription>Ces informations seront visibles par les clients.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSave} className="space-y-4">
              <div className="space-y-2">
                <Label>Nom commercial</Label>
                <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Ex: BlobPro School" />
              </div>
              <div className="space-y-2">
                <Label>Présentation</Label>
                <Textarea value={bio} onChange={(e)=>setBio(e.target.value)} placeholder="Ce que tu proposes, ton expérience, ton spot préféré…" />
              </div>
              <div className="space-y-2">
                <Label>Tarif horaire (EUR)</Label>
                <Input type="number" value={pricePerHour} onChange={(e)=> setPricePerHour(e.target.value === '' ? '' : Number(e.target.value))} min={0} />
              </div>
              <div className="space-y-2">
                <Label>Photo/Logo</Label>
                <input type="file" accept="image/*" onChange={onPick} />
                {photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="aperçu" className="h-32 w-32 object-cover rounded" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <input id="notif" type="checkbox" checked={emailNotif} onChange={(e)=>setEmailNotif(e.target.checked)} />
                <Label htmlFor="notif" className="!m-0">Recevoir des emails pour les nouvelles demandes</Label>
              </div>
              {err && <p className="text-sm text-red-600">{err}</p>}
              <Button type="submit" className="w-full sm:w-auto">Enregistrer</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

