"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import { apiRequest } from '../../../lib/csrf';

// Configuration de sécurité pour l'upload de fichiers
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// Helper pour sanitizer les messages d'erreur
function sanitizeErrorMessage(error: unknown): string {
  const getMessage = () => {
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      const potentialMessage = (error as { message?: unknown }).message;
      if (typeof potentialMessage === 'string') {
        return potentialMessage;
      }
    }
    return 'Erreur inconnue';
  };

  if (process.env.NODE_ENV === 'production') {
    const knownErrors: Record<string, string> = {
      CSRF_INVALID_TOKEN: 'Session expirée, veuillez rafraîchir la page',
      CSRF_NO_TOKEN: 'Session expirée, veuillez rafraîchir la page',
      UNAUTHORIZED: 'Veuillez vous reconnecter',
      FILE_TOO_LARGE: 'Le fichier est trop volumineux (max 5 Mo)',
      INVALID_FILE_TYPE: 'Type de fichier non supporté',
    };

    if (error && typeof error === 'object') {
      const { code, message } = error as { code?: unknown; message?: unknown };
      const errorCode =
        (typeof code === 'string' && code) || (typeof message === 'string' ? message : undefined);
      if (errorCode && knownErrors[errorCode]) {
        return knownErrors[errorCode];
      }
    }

    return 'Une erreur est survenue. Veuillez réessayer.';
  }

  return getMessage();
}

export default function ProProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [bio, setBio] = useState('');
  const [emailNotif, setEmailNotif] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Hook pour vérifier l'authentification
  const ensureAuthenticated = useCallback(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      throw new Error('Session expirée');
    }
    return t;
  }, [router]);

  // Cleanup blob URL à la destruction
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const t = ensureAuthenticated();

        // ✅ CORRIGÉ : Utiliser apiRequest avec protection CSRF
        const response = await apiRequest('/pro/me', {
          method: 'GET',
          headers: { Authorization: `Bearer ${t.accessToken}` },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || 'Erreur chargement');
        }

        setBusinessName(data.businessName || '');
        setBio(data.bio || '');
        setEmailNotif(!!data.emailNotif);
        setPhotoUrl(data.photoUrl || null);
      } catch (e) {
        setErr(sanitizeErrorMessage(e));
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [ensureAuthenticated]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // ✅ CORRIGÉ : Validation 1 - Taille du fichier
    if (f.size > MAX_FILE_SIZE) {
      setErr('Le fichier est trop volumineux (max 5 Mo)');
      e.target.value = '';
      return;
    }

    // ✅ CORRIGÉ : Validation 2 - Type MIME
    if (!ALLOWED_TYPES.includes(f.type)) {
      setErr('Format non supporté. Utilisez JPG, PNG, WebP ou GIF.');
      e.target.value = '';
      return;
    }

    // ✅ CORRIGÉ : Validation 3 - Extension
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext || '')) {
      setErr('Extension de fichier invalide.');
      e.target.value = '';
      return;
    }

    // ✅ CORRIGÉ : Libérer l'ancien blob avant d'en créer un nouveau
    if (blobUrl) URL.revokeObjectURL(blobUrl);

    const newBlobUrl = URL.createObjectURL(f);
    setBlobUrl(newBlobUrl);
    setPhotoUrl(newBlobUrl);
    setFile(f);
    setErr(null); // Clear error on successful selection
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    try {
      const t = ensureAuthenticated();
      let finalUrl = photoUrl || undefined;

      if (file) {
        const ct = file.type || 'image/jpeg';

        // ✅ CORRIGÉ : Utiliser apiRequest avec protection CSRF
        const p = await apiRequest('/pro/photo/upload-url', {
          method: 'POST',
          body: JSON.stringify({ contentType: ct }),
          headers: { Authorization: `Bearer ${t.accessToken}` },
        });

        const data = await p.json();
        if (!p.ok) throw new Error(data?.error || 'Upload préparatoire impossible');

        // Upload vers S3/storage (pas de CSRF nécessaire - endpoint tiers)
        await fetch(data.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': ct },
          body: file
        });

        if (data.fileUrl) finalUrl = data.fileUrl;
      }

      // ✅ CORRIGÉ : Utiliser apiRequest avec protection CSRF
      const res = await apiRequest('/pro/me', {
        method: 'PUT',
        body: JSON.stringify({
          businessName: businessName || undefined,
          bio: bio || undefined,
          emailNotif,
          photoUrl: finalUrl,
        }),
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Sauvegarde impossible');

      // Rediriger vers l'onboarding avec un timestamp pour forcer le rechargement
      router.push(`/pro/onboarding?refresh=${Date.now()}`);
    } catch (e: unknown) {
      // ✅ CORRIGÉ : Sanitization des erreurs
      setErr(sanitizeErrorMessage(e));
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
                <Input
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Ex: BlobPro School"
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label>Présentation</Label>
                <Textarea
                  value={bio}
                  onChange={(e)=>setBio(e.target.value)}
                  placeholder="Ce que tu proposes, ton expérience, ton spot préféré…"
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label>Photo/Logo</Label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={onPick}
                  aria-label="Sélectionner une photo de profil"
                />
                {photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoUrl}
                    alt="Aperçu de la photo de profil"
                    className="h-32 w-32 object-cover rounded"
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="notif"
                  type="checkbox"
                  checked={emailNotif}
                  onChange={(e)=>setEmailNotif(e.target.checked)}
                  aria-label="Recevoir des emails pour les nouvelles demandes"
                />
                <Label htmlFor="notif" className="!m-0">Recevoir des emails pour les nouvelles demandes</Label>
              </div>
              {err && (
                <div
                  className="text-sm text-red-600 p-3 bg-red-50 rounded border border-red-200"
                  role="alert"
                  aria-live="assertive"
                >
                  {err}
                </div>
              )}
              <Button type="submit" className="w-full sm:w-auto">Enregistrer</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
