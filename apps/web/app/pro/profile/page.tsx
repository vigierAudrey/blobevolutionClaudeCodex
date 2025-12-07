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
import { useToast } from '../../../components/ui/toast';

// Configuration de sécurité pour l'upload de fichiers
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

type DeletionStatus = {
  isScheduled: boolean;
  deletedAt?: string;
  deletionDate?: string;
  daysRemaining?: number;
};

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
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [bio, setBio] = useState('');
  const [emailNotif, setEmailNotif] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Account deletion modal state
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);
  const [loadingDeletion, setLoadingDeletion] = useState(false);

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

  const checkDeletionStatus = useCallback(async () => {
    try {
      const t = ensureAuthenticated();

      const response = await apiRequest('/pro/deletion-status', {
        method: 'GET',
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });

      if (response.ok) {
        const data = await response.json();
        setDeletionStatus(data);
      }
    } catch (error) {
      console.error('Error checking deletion status:', error);
    }
  }, [ensureAuthenticated]);

  const handleRequestDeletion = async () => {
    setLoadingDeletion(true);
    try {
      const t = ensureAuthenticated();

      const response = await apiRequest('/pro/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la demande de suppression');
      }

      setDeletionStatus({
        isScheduled: true,
        deletedAt: data.deletedAt,
        deletionDate: data.deletionDate,
        daysRemaining: data.daysRemaining,
      });

      toast('Demande de suppression enregistrée. Vous avez 30 jours pour annuler.', 'success');
      setShowDeletionModal(false);
    } catch (e: unknown) {
      setErr(sanitizeErrorMessage(e));
    } finally {
      setLoadingDeletion(false);
    }
  };

  const handleCancelDeletion = async () => {
    setLoadingDeletion(true);
    try {
      const t = ensureAuthenticated();

      const response = await apiRequest('/pro/cancel-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'annulation');
      }

      setDeletionStatus({ isScheduled: false });
      toast('Suppression de compte annulée avec succès', 'success');
    } catch (e: unknown) {
      setErr(sanitizeErrorMessage(e));
    } finally {
      setLoadingDeletion(false);
    }
  };

  // Check deletion status on mount
  useEffect(() => {
    void checkDeletionStatus();
  }, [checkDeletionStatus]);

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
        <>
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

          {/* RGPD & Privacy Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">🔒 Confidentialité & RGPD</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Conformément au RGPD, vous pouvez exporter ou supprimer vos données personnelles à tout moment.
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={async () => {
                      try {
                        const tokens = apiClient.getTokens();
                        if (!tokens?.accessToken) {
                          toast('Session expirée, veuillez vous reconnecter', 'error');
                          return;
                        }

                        toast('Génération de l\'export en cours...', 'info');

                        const response = await apiRequest('/pro/export', {
                          method: 'GET',
                          headers: { Authorization: `Bearer ${tokens.accessToken}` },
                        });

                        if (!response.ok) {
                          const errorData = await response.json().catch(() => ({}));
                          throw new Error(errorData.error || 'Erreur lors de l\'export');
                        }

                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `blobinfini-data-export-${new Date().toISOString().split('T')[0]}.json`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);

                        toast('Export téléchargé avec succès', 'success');
                      } catch (error) {
                        const message = error instanceof Error ? error.message : 'Erreur lors de l\'export';
                        toast(message, 'error');
                      }
                    }}
                  >
                    📥 Exporter mes données
                  </button>
                  <span className="text-muted-foreground">•</span>
                  {deletionStatus?.isScheduled ? (
                    <button
                      type="button"
                      className="text-sm text-orange-600 hover:underline font-medium"
                      onClick={handleCancelDeletion}
                      disabled={loadingDeletion}
                    >
                      ⚠️ Annuler la suppression ({deletionStatus.daysRemaining} jours restants)
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => setShowDeletionModal(true)}
                    >
                      🗑️ Supprimer mon compte
                    </button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Account Deletion Modal */}
      {showDeletionModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowDeletionModal(false)}
        >
          <Card
            className="max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle className="text-xl text-red-600">⚠️ Suppression de compte</CardTitle>
              <CardDescription>
                Cette action entraînera la suppression définitive de votre compte dans 30 jours
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-sm">📅 Comment fonctionne la suppression ?</h3>
                <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
                  <li>Votre compte sera <strong>immédiatement désactivé</strong></li>
                  <li>Vos données seront <strong>conservées pendant 30 jours</strong></li>
                  <li>Vous pourrez <strong>annuler</strong> la suppression durant cette période</li>
                  <li>Après 30 jours, vos données seront <strong>définitivement supprimées</strong></li>
                </ol>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-sm">💡 Avant de supprimer</h3>
                <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                  <li>Vous pouvez <strong>exporter vos données</strong> (droit RGPD)</li>
                  <li>Pensez à <strong>clôturer vos offres</strong> en cours</li>
                  <li>Vos messages seront supprimés définitivement</li>
                </ul>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowDeletionModal(false)}
                  disabled={loadingDeletion}
                >
                  Annuler
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="flex-1"
                  onClick={handleRequestDeletion}
                  disabled={loadingDeletion}
                >
                  {loadingDeletion ? 'Traitement...' : 'Confirmer la suppression'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
