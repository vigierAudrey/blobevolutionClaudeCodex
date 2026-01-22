"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { MapPin, Cookie, Trash2, Target, Shield, Ban, FileText, Bell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '../../../lib/apiClient';
import { apiRequest } from '../../../lib/csrf';
import { useToast } from '../../../components/ui/toast';
import { Spinner } from '../../../components/ui/spinner';
import { COOKIE_CONSENT_REOPEN_EVENT, useCookieConsent } from '../../../components/cookies/CookieConsent';
import { ChangePasswordCard } from '../../../components/profile/ChangePasswordCard';

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

// P2-1 (audit) : validation défensive des coordonnées GPS avant affichage.
const sanitizeCoordinate = (value: number, min: number, max: number): string => {
  if (typeof value !== 'number' || isNaN(value) || value < min || value > max) {
    return 'N/A';
  }
  return value.toFixed(4);
};

export default function ProProfilePage() {
  const router = useRouter();
  const toast = useToast();
  const { updateConsent: resetConsent, consentReady: consentStateReady, consentLevel } = useCookieConsent();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [bio, setBio] = useState('');
  const [emailNotif, setEmailNotif] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Geolocation state
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [deletingLocation, setDeletingLocation] = useState(false);

  // Account deletion modal state
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);
  const [loadingDeletion, setLoadingDeletion] = useState(false);

  // Notification preferences state
  const [notificationPrefs, setNotificationPrefs] = useState({
    pushEnabled: true,
    emailEnabled: false,
    notifyLessonRequests: true,
    notifyBookingAccepted: true,
    notifyBookingRejected: true,
    notifyProMessages: true,
    notifyForSurf: true,
    notifyForKitesurf: true,
    emailDigestFrequency: 'NEVER',
  });
  const [loadingNotifPrefs, setLoadingNotifPrefs] = useState(true);
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false);

  // P2-2 (audit) : throttling local pour réouverture du consentement cookies.
  const lastConsentReopenRef = useRef<number>(0);
  const CONSENT_REOPEN_COOLDOWN_MS = 2000; // 2 secondes entre deux appels

  // Cookie consent summary
  const consentSummary = useMemo(() => {
    type Summary = {
      label: string;
      description: string;
      Icon: LucideIcon;
      badge?: { text: string; className?: string };
      cardClasses: string;
      iconClasses: string;
    };
    const baseBadge = 'border-none text-xs font-semibold';

    const summaries: Record<string, Summary> = {
      personalized: {
        label: 'Publicités personnalisées',
        description: 'Équipements sélectionnés selon ton activité professionnelle. Aide à financer la plateforme.',
        Icon: Target,
        badge: { text: 'Recommandé', className: `${baseBadge} bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400` },
        cardClasses: 'border-blue-200 bg-blue-50/70 dark:border-blue-800/50 dark:bg-blue-950/20',
        iconClasses: 'text-blue-600 dark:text-blue-400',
      },
      essential: {
        label: 'Publicités basiques',
        description: 'Annonces générales sans profilage ; aucune donnée personnelle utilisée.',
        Icon: Shield,
        badge: { text: 'Essentiel', className: `${baseBadge} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400` },
        cardClasses: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/50 dark:bg-emerald-950/20',
        iconClasses: 'text-emerald-600 dark:text-emerald-400',
      },
      none: {
        label: 'Publicités limitées',
        description: 'Seules les annonces internes (House Ads) sont affichées.',
        Icon: Ban,
        badge: { text: 'House ads', className: `${baseBadge} bg-slate-200 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300` },
        cardClasses: 'border-slate-200 bg-slate-50 dark:border-slate-800/50 dark:bg-slate-900/20',
        iconClasses: 'text-slate-500 dark:text-slate-400',
      },
    };

    return summaries[consentLevel] ?? summaries.none;
  }, [consentLevel]);

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

  // Load notification preferences on mount
  useEffect(() => {
    const loadNotificationPreferences = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) return;

        const response = await apiRequest('/profile/notifications', {
          method: 'GET',
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.preferences) {
            setNotificationPrefs((prev) => ({ ...prev, ...data.preferences }));
          }
        }
      } catch (error) {
        console.error('Error loading notification preferences:', error);
      } finally {
        setLoadingNotifPrefs(false);
      }
    };

    void loadNotificationPreferences();
  }, []);

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

        // Load geolocation if available
        if (data.lat != null && data.lng != null) {
          setUserLocation({ lat: data.lat, lng: data.lng });
        } else {
          setUserLocation(null);
        }
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

  // Handler pour supprimer la géolocalisation
  const handleDeleteLocation = async () => {
    if (!confirm('Supprimer votre géolocalisation ? Vous devrez la réactiver depuis la BloboMap ou vos Offres pour apparaître dans les recherches à proximité.')) {
      return;
    }

    setDeletingLocation(true);
    try {
      const t = ensureAuthenticated();

      const response = await apiRequest('/pro/me', {
        method: 'PUT',
        body: JSON.stringify({ lat: undefined, lng: undefined }),
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Erreur lors de la suppression');
      }

      setUserLocation(null);
      toast('Géolocalisation supprimée', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la suppression';
      toast(message, 'error');
    } finally {
      setDeletingLocation(false);
    }
  };

  // Handler pour rouvrir la modale de consentement cookies
  // P2-2/P2-3 (audit) : throttling + logs dev-only lors de la réouverture.
  const handleReopenCookieConsent = useCallback(async () => {
    if (!consentStateReady) {
      toast('Préférences cookies en cours de chargement, réessaie dans un instant.', 'info');
      return;
    }

    // P2-2 : rate limiting côté client.
    const now = Date.now();
    if (now - lastConsentReopenRef.current < CONSENT_REOPEN_COOLDOWN_MS) {
      // P2-2 : toast informatif (type "warning" indisponible ici).
      toast('Merci de patienter quelques secondes avant de réessayer.', 'info');
      return;
    }
    lastConsentReopenRef.current = now;

    await resetConsent('none');
    document.cookie = 'cookie_consent=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

    if (typeof window !== 'undefined') {
      try {
        if ('localStorage' in window) {
          window.localStorage.removeItem('blob_consent');
          window.localStorage.removeItem('cookie-consent');
        }
        window.dispatchEvent(new Event(COOKIE_CONSENT_REOPEN_EVENT));
      } catch (error) {
        // P2-3 : log détaillé uniquement en dev.
        if (process.env.NODE_ENV === 'development') {
          console.warn('Impossible de rouvrir la fenêtre de consentement', error);
        }
        window.location.reload();
      }
    }
  }, [consentStateReady, resetConsent, toast]);

  const toggleNotificationPref = (key: keyof typeof notificationPrefs) => {
    setNotificationPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const saveNotificationPreferences = async () => {
    if (savingNotifPrefs) return;
    setSavingNotifPrefs(true);

    try {
      const tokens = apiClient.getTokens();
      if (!tokens?.accessToken) {
        toast('Session expirée, veuillez vous reconnecter', 'error');
        return;
      }

      const response = await apiRequest('/profile/notifications', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        body: JSON.stringify(notificationPrefs),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erreur lors de la sauvegarde');
      }

      toast('Préférences de notification sauvegardées', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde';
      toast(message, 'error');
    } finally {
      setSavingNotifPrefs(false);
    }
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
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      {/* Header compact avec style océan */}
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20 p-4 border-2 border-amber-200/50 dark:border-amber-800/50">
        <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Profil Professionnel 💼</h1>
          <p className="text-sm text-muted-foreground">Gère tes informations visibles par les clients</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Chargement…</p>
        </div>
      ) : (
        <>
          <Card className="border-2 rounded-[1.75rem]">
            <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30">
              <CardTitle className="text-foreground">Mes infos pro</CardTitle>
              <CardDescription>Ces informations seront visibles par les clients.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
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
                    className="rounded-2xl border-2 border-red-200 dark:border-red-800/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 p-4"
                    role="alert"
                    aria-live="assertive"
                  >
                    <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                      ❌ {err}
                    </p>
                  </div>
                )}
                <Button type="submit" className="w-full sm:w-auto bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700">
                  Enregistrer
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Security Section */}
          <ChangePasswordCard />

          {/* RGPD & Privacy Section */}
          <Card className="border-2 rounded-[1.75rem]">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30">
              <CardTitle className="text-base text-foreground">🔒 Confidentialité & RGPD</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                {/* Geolocation Section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Géolocalisation</h3>
                  </div>
                  {userLocation ? (
                    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/20 p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-emerald-600 text-lg">📍</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                            Position active
                          </p>
                          <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                            {/* P2-1 (audit) : affichage défensif des coordonnées. */}
                            Lat: {sanitizeCoordinate(userLocation.lat, -90, 90)}, Lng: {sanitizeCoordinate(userLocation.lng, -180, 180)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            Précision approximative (~1 km) pour préserver votre confidentialité
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Utilisée pour apparaître dans les recherches à proximité sur la BloboMap
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleDeleteLocation}
                        disabled={deletingLocation}
                        className="w-full sm:w-auto"
                      >
                        <Trash2 className="h-3 w-3 mr-2" />
                        {deletingLocation ? 'Suppression...' : 'Supprimer ma position'}
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/20 p-4">
                      <p className="text-sm text-muted-foreground flex items-start gap-2">
                        <span>ℹ️</span>
                        <span>Aucune géolocalisation enregistrée. Active-la depuis la BloboMap ou tes Offres pour apparaître dans les recherches à proximité.</span>
                      </p>
                    </div>
                  )}
                </div>

                <hr className="border-t-2" />

                {/* Cookie Preferences Section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Cookie className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Préférences Cookies</h3>
                  </div>
                  {consentStateReady ? (
                    <div className="space-y-3">
                      <div className={`flex items-start gap-3 rounded-xl border-2 p-4 ${consentSummary.cardClasses}`}>
                        <consentSummary.Icon className={`h-5 w-5 ${consentSummary.iconClasses} flex-shrink-0 mt-0.5`} />
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{consentSummary.label}</p>
                            {consentSummary.badge && (
                              <Badge className={consentSummary.badge.className}>{consentSummary.badge.text}</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{consentSummary.description}</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleReopenCookieConsent}
                        className="w-full sm:w-auto"
                      >
                        Gérer mes cookies
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-dashed p-4 text-sm text-muted-foreground">
                      Chargement des préférences…
                    </div>
                  )}
                </div>

                <hr className="border-t-2" />

                {/* Notification Preferences */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Préférences de Notification</h3>
                  </div>
                  {loadingNotifPrefs ? (
                    <div className="rounded-xl border-2 border-dashed p-4 text-sm text-muted-foreground">
                      Chargement des préférences…
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Push Notifications Master Toggle */}
                      <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border-2 border-purple-200/50 dark:border-purple-800/50">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                            <Bell className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold">Notifications Push</h4>
                            <p className="text-xs text-muted-foreground">Reçois des alertes instantanées</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleNotificationPref('pushEnabled')}
                          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                            notificationPrefs.pushEnabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                          aria-label="Toggle push notifications"
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                              notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {/* PRO-specific preferences */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Activité professionnelle</h4>

                        {/* Lesson Requests */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-amber-300 dark:hover:border-amber-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🗺️</span>
                            <div>
                              <p className="text-sm font-medium">Demandes de cours (BloboMap)</p>
                              <p className="text-xs text-muted-foreground">Riders cherchant un cours</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyLessonRequests')}
                            disabled={!notificationPrefs.pushEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyLessonRequests && notificationPrefs.pushEnabled
                                ? 'bg-amber-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle lesson request notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyLessonRequests && notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* Booking Accepted */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-green-300 dark:hover:border-green-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">✅</span>
                            <div>
                              <p className="text-sm font-medium">Réservations acceptées</p>
                              <p className="text-xs text-muted-foreground">Quand un rider accepte ta dispo</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyBookingAccepted')}
                            disabled={!notificationPrefs.pushEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyBookingAccepted && notificationPrefs.pushEnabled
                                ? 'bg-green-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle booking accepted notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyBookingAccepted && notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* Booking Rejected */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-red-300 dark:hover:border-red-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">❌</span>
                            <div>
                              <p className="text-sm font-medium">Réservations refusées</p>
                              <p className="text-xs text-muted-foreground">Quand un rider refuse ta dispo</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyBookingRejected')}
                            disabled={!notificationPrefs.pushEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyBookingRejected && notificationPrefs.pushEnabled
                                ? 'bg-red-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle booking rejected notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyBookingRejected && notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* PRO Messages */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">💬</span>
                            <div>
                              <p className="text-sm font-medium">Messages</p>
                              <p className="text-xs text-muted-foreground">Messages des riders</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyProMessages')}
                            disabled={!notificationPrefs.pushEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyProMessages && notificationPrefs.pushEnabled
                                ? 'bg-blue-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle message notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyProMessages && notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Sport filters */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filtres par sport</h4>

                        {/* Surf */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🏄</span>
                            <div>
                              <p className="text-sm font-medium">Demandes Surf</p>
                              <p className="text-xs text-muted-foreground">Cours de surf uniquement</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyForSurf')}
                            disabled={!notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyForSurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests
                                ? 'bg-blue-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle surf notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyForSurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* Kitesurf */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-cyan-300 dark:hover:border-cyan-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🪁</span>
                            <div>
                              <p className="text-sm font-medium">Demandes Kitesurf</p>
                              <p className="text-xs text-muted-foreground">Cours de kitesurf uniquement</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyForKitesurf')}
                            disabled={!notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyForKitesurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests
                                ? 'bg-cyan-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle kitesurf notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyForKitesurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Info box when push disabled */}
                      {!notificationPrefs.pushEnabled && (
                        <div className="rounded-lg border-2 border-amber-200 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 p-3">
                          <div className="flex items-start gap-2">
                            <span className="text-lg">ℹ️</span>
                            <div className="flex-1">
                              <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Notifications désactivées</p>
                              <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
                                Active les notifications push pour recevoir des alertes en temps réel.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Save button */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={saveNotificationPreferences}
                        disabled={savingNotifPrefs}
                        className="w-full sm:w-auto"
                      >
                        {savingNotifPrefs ? (
                          <span className="inline-flex items-center gap-2">
                            <Spinner />
                            Sauvegarde...
                          </span>
                        ) : (
                          '💾 Sauvegarder mes préférences'
                        )}
                      </Button>
                    </div>
                  )}
                </div>

                <hr className="border-t-2" />

                {/* RGPD Rights */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Vos Droits RGPD</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification, de suppression et de portabilité de vos données.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Link href="/about">
                      <Button variant="outline" size="sm">
                        <FileText className="h-3.5 w-3.5 mr-2" />
                        Politique RGPD
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
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
                    </Button>
                    {deletionStatus?.isScheduled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleCancelDeletion}
                        disabled={loadingDeletion}
                        className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      >
                        ⚠️ Annuler suppression ({deletionStatus.daysRemaining}j)
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => setShowDeletionModal(true)}
                        className="border-red-300 text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Supprimer mon compte
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Account Deletion Modal */}
      {showDeletionModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowDeletionModal(false)}
        >
          <Card
            className="max-w-lg w-full border-2 rounded-[1.75rem] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30">
              <CardTitle className="text-xl text-red-600 dark:text-red-400">⚠️ Suppression de compte</CardTitle>
              <CardDescription className="text-red-700 dark:text-red-300">
                Cette action entraînera la suppression définitive de votre compte dans 30 jours
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 p-4 space-y-2">
                <h3 className="font-semibold text-sm text-amber-900 dark:text-amber-100">📅 Comment fonctionne la suppression ?</h3>
                <ol className="text-sm space-y-1 list-decimal list-inside text-amber-800 dark:text-amber-200">
                  <li>Votre compte sera <strong>immédiatement désactivé</strong></li>
                  <li>Vos données seront <strong>conservées pendant 30 jours</strong></li>
                  <li>Vous pourrez <strong>annuler</strong> la suppression durant cette période</li>
                  <li>Après 30 jours, vos données seront <strong>définitivement supprimées</strong></li>
                </ol>
              </div>

              <div className="rounded-2xl border-2 border-blue-200 dark:border-blue-800/50 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 p-4 space-y-2">
                <h3 className="font-semibold text-sm text-blue-900 dark:text-blue-100">💡 Avant de supprimer</h3>
                <ul className="text-sm space-y-1 list-disc list-inside text-blue-800 dark:text-blue-200">
                  <li>Vous pouvez <strong>exporter vos données</strong> (droit RGPD)</li>
                  <li>Pensez à <strong>clôturer vos offres</strong> en cours</li>
                  <li>Vos messages seront supprimés définitivement</li>
                </ul>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
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
                  className="flex-1 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700"
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
