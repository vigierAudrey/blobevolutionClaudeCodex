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
import { Bell, Ban, CalendarClock, Cookie, Eye, FileText, Info, Lightbulb, Mail, MapPin, MessageSquare, RefreshCw, Shield, Target, Trash2, Waves, Wind } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '../../../lib/apiClient';
import { apiRequest } from '../../../lib/csrf';
import { useToast } from '../../../components/ui/toast';
import { Spinner } from '../../../components/ui/spinner';
import { COOKIE_CONSENT_REOPEN_EVENT, useCookieConsent } from '../../../components/cookies/CookieConsent';
import { ChangePasswordCard } from '../../../components/profile/ChangePasswordCard';
import { FRANCE_ONLY_COUNTRY_CODE, PRO_BETA_INFO_MESSAGE } from '../../../lib/franceLaunch';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobMark } from '@/components/blob';
import { usePushNotifications } from '@/hooks/usePushNotifications';

// Configuration de sécurité pour l'upload de fichiers
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

const toggleTrackClass = (checked: boolean, disabled = false, size: 'sm' | 'md' = 'md') =>
  [
    'relative inline-flex shrink-0 items-center rounded-sm border-2 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2',
    size === 'sm' ? 'h-6 w-11' : 'h-7 w-12',
    checked ? 'border-blob-black bg-blob-yellow' : 'border-blob-black/30 bg-white dark:border-white/25 dark:bg-white/10',
    disabled ? 'cursor-not-allowed opacity-50' : '',
  ].join(' ');

const toggleThumbClass = (checked: boolean, size: 'sm' | 'md' = 'md') =>
  [
    'inline-block transform rounded-sm border-2 border-blob-black bg-blob-black transition-transform',
    size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
    checked ? (size === 'sm' ? 'translate-x-6' : 'translate-x-5') : 'translate-x-1',
  ].join(' ');

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
      RATE_LIMIT_EXCEEDED: 'Trop de tentatives. Veuillez patienter quelques minutes avant de réessayer.',
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
  const { updateConsent: resetConsent, consentReady: consentStateReady, consentLevel } = useCookieConsent();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [bio, setBio] = useState('');
  const [emailNotif, setEmailNotif] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Geolocation state
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [deletingLocation, setDeletingLocation] = useState(false);
  const [updatingLocation, setUpdatingLocation] = useState(false);
  const [geolocPermissionDenied, setGeolocPermissionDenied] = useState(false);
  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [savingRadius, setSavingRadius] = useState(false);
  const radiusPersistRef = useRef<ReturnType<typeof setTimeout>>();
  const lastSavedRadiusRef = useRef<number | null>(null);

  // Account deletion modal state
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);
  const [loadingDeletion, setLoadingDeletion] = useState(false);

  // Notification preferences state
  const [notificationPrefs, setNotificationPrefs] = useState({
    inAppEnabled: true,
    pushEnabled: true,
    emailEnabled: false,
    notifyLessonRequests: true,
    notifyProMessages: true,
    notifyForSurf: true,
    notifyForKitesurf: true,
    emailDigestFrequency: 'NEVER',
  });
  const [loadingNotifPrefs, setLoadingNotifPrefs] = useState(true);
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false);

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
    const baseBadge = 'text-xs font-black uppercase tracking-widest';

    const summaries: Record<string, Summary> = {
      personalized: {
        label: 'Expérience optimisée',
        description: 'Navigation adaptée à vos habitudes sur Blob, avec statistiques d\'usage enrichies.',
        Icon: Target,
        badge: { text: 'Recommandé', className: `${baseBadge} border-blob-yellow bg-blob-yellow text-blob-black` },
        cardClasses: 'border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5',
        iconClasses: 'text-blob-black dark:text-white',
      },
      essential: {
        label: 'Fonctionnel & mesure anonyme',
        description: 'Session, sécurité et statistiques d\'usage sans identification personnelle.',
        Icon: Shield,
        badge: { text: 'Actif', className: `${baseBadge} border-blob-black bg-blob-black text-white` },
        cardClasses: 'border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5',
        iconClasses: 'text-blob-black dark:text-white',
      },
      none: {
        label: 'Essentiel uniquement',
        description: 'Cookies strictement nécessaires, sans aucune statistique d\'usage.',
        Icon: Ban,
        badge: { text: 'Minimal', className: `${baseBadge} border-blob-sand-deep bg-white text-blob-black dark:border-white/20 dark:bg-white/10 dark:text-white` },
        cardClasses: 'border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5',
        iconClasses: 'text-blob-black/70 dark:text-white/70',
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
      } catch {
        // Préférences optionnelles : l'écran reste utilisable sans exposer l'erreur brute.
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

        // Server-side role is the source of truth — RIDER must not stay on PRO-only page.
        const me = await apiClient.me();
        if (me.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }

        // ✅ CORRIGÉ : Utiliser apiRequest avec protection CSRF
        const response = await apiRequest('/pro/me', {
          method: 'GET',
          headers: { Authorization: `Bearer ${t.accessToken}` },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.message || data?.error || 'Erreur chargement');
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

        const storedRadius = typeof data.radiusKm === 'number' ? data.radiusKm : 25;
        const clampedRadius = Math.max(1, Math.min(200, storedRadius));
        setRadiusKm(clampedRadius);
        lastSavedRadiusRef.current = clampedRadius;
      } catch (e) {
        setErr(sanitizeErrorMessage(e));
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [ensureAuthenticated, router]);

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
    } catch {
      // Statut RGPD non bloquant : ne pas logger de détail de compte côté client.
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

  // Handler pour activer/actualiser la géolocalisation via GPS navigateur
  const handleUpdateLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast('La géolocalisation n\'est pas supportée par ce navigateur.', 'error');
      return;
    }
    setUpdatingLocation(true);
    setGeolocPermissionDenied(false);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        try {
          const t = ensureAuthenticated();
          const response = await apiRequest('/pro/me', {
            method: 'PUT',
            body: JSON.stringify({ countryCode: FRANCE_ONLY_COUNTRY_CODE, lat, lng }),
            headers: { Authorization: `Bearer ${t.accessToken}` },
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data?.message || data?.error || 'Erreur lors de la mise à jour');
          }
          setUserLocation({ lat, lng });
          toast('Position mise à jour', 'success');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Erreur lors de la mise à jour';
          toast(message, 'error');
        } finally {
          setUpdatingLocation(false);
        }
      },
      () => {
        setGeolocPermissionDenied(true);
        setUpdatingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }, [ensureAuthenticated, toast]);

  // Handler pour supprimer la géolocalisation
  const handleDeleteLocation = async () => {
    if (!confirm('Supprimer votre géolocalisation ? Vous devrez la réactiver depuis la BloboMap pour apparaître dans les recherches à proximité.')) {
      return;
    }

    setDeletingLocation(true);
    try {
      const t = ensureAuthenticated();

      const response = await apiRequest('/pro/me', {
        method: 'PUT',
        body: JSON.stringify({ countryCode: FRANCE_ONLY_COUNTRY_CODE, lat: undefined, lng: undefined }),
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || data?.error || 'Erreur lors de la suppression');
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

  // Sauvegarde du rayon avec debounce 500ms
  useEffect(() => {
    if (lastSavedRadiusRef.current === null || lastSavedRadiusRef.current === radiusKm) return;

    const persist = async () => {
      setSavingRadius(true);
      try {
        const t = ensureAuthenticated();
        const response = await apiRequest('/pro/me', {
          method: 'PATCH',
          body: JSON.stringify({ countryCode: FRANCE_ONLY_COUNTRY_CODE, radiusKm }),
          headers: { Authorization: `Bearer ${t.accessToken}` },
        });
        const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
        if (!response.ok) {
          throw new Error(body.message || body.error || 'Erreur lors de la sauvegarde du rayon');
        }
        lastSavedRadiusRef.current = radiusKm;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde du rayon';
        toast(message, 'error');
      } finally {
        setSavingRadius(false);
      }
    };

    if (radiusPersistRef.current) clearTimeout(radiusPersistRef.current);
    radiusPersistRef.current = setTimeout(() => { void persist(); }, 500);

    return () => {
      if (radiusPersistRef.current) clearTimeout(radiusPersistRef.current);
    };
  }, [radiusKm, ensureAuthenticated, toast]);

  // Handler pour rouvrir la modale de consentement cookies
  const handleReopenCookieConsent = async () => {
    // Confirmation utilisateur avant réinitialisation
    if (!confirm('Réinitialiser vos préférences de confidentialité ? Cette action ouvrira à nouveau le dialogue.')) {
      return;
    }

    if (!consentStateReady) {
      toast('Préférences en cours de chargement, réessaie dans un instant.', 'info');
      return;
    }

    try {
      await resetConsent('none');

      // Utiliser SameSite=Strict pour meilleure sécurité
      document.cookie = 'cookie_consent=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict';

      if (typeof window !== 'undefined') {
        try {
          if ('localStorage' in window) {
            window.localStorage.removeItem('blob_consent');
            window.localStorage.removeItem('cookie-consent');
          }
          window.dispatchEvent(new Event(COOKIE_CONSENT_REOPEN_EVENT));
        } catch {
          toast('Erreur lors de la réinitialisation. Rafraîchissez la page.', 'error');
          // Reload seulement en dernier recours après 2 secondes
          setTimeout(() => window.location.reload(), 2000);
        }
      }
    } catch {
      toast('Erreur lors de la réinitialisation des préférences.', 'error');
    }
  };

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

      // Sauvegarde in-app/push toggles + emailNotif en parallèle.
      const [notifRes, proRes] = await Promise.all([
        apiRequest('/profile/notifications', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          body: JSON.stringify(notificationPrefs),
        }),
        apiRequest('/pro/me', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          body: JSON.stringify({ emailNotif, countryCode: FRANCE_ONLY_COUNTRY_CODE }),
        }),
      ]);

      if (!notifRes.ok) {
        const errorData = await notifRes.json().catch(() => ({})) as { error?: string };
        throw new Error(errorData.error || 'Erreur lors de la sauvegarde des alertes');
      }
      if (!proRes.ok) {
        const errorData = await proRes.json().catch(() => ({})) as { error?: string };
        throw new Error(errorData.error || 'Erreur lors de la sauvegarde des préférences email');
      }

      toast('Préférences sauvegardées', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde';
      toast(message, 'error');
    } finally {
      setSavingNotifPrefs(false);
    }
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setErr(null);
    setSaving(true);

    try {
      const t = ensureAuthenticated();
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
        const putRes = await fetch(data.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': ct },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Échec du téléversement (${putRes.status})`);

        // Finalize: valide le contenu côté serveur et retourne la photoUrl officielle
        const finalizeRes = await apiRequest('/pro/photo/finalize', {
          method: 'POST',
          body: JSON.stringify({ key: data.key }),
          headers: { Authorization: `Bearer ${t.accessToken}` },
        });
        if (!finalizeRes.ok) throw new Error('Échec de la validation de la photo');
        const { photoUrl: finalizedUrl } = (await finalizeRes.json()) as { photoUrl: string };
        setPhotoUrl(finalizedUrl);
      }

      // ✅ CORRIGÉ : Utiliser apiRequest avec protection CSRF
      const res = await apiRequest('/pro/me', {
        method: 'PUT',
        body: JSON.stringify({
          businessName: businessName || undefined,
          bio: bio || undefined,
          countryCode: FRANCE_ONLY_COUNTRY_CODE,
        }),
        headers: { Authorization: `Bearer ${t.accessToken}` },
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body?.message || body?.error || 'Sauvegarde impossible');

      // Rediriger vers l'onboarding avec un timestamp pour forcer le rechargement
      router.push(`/pro/onboarding?refresh=${Date.now()}`);
    } catch (e: unknown) {
      // ✅ CORRIGÉ : Sanitization des erreurs
      setErr(sanitizeErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      <BlobCard mode="yellowSignal">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
              <BlobMark size={26} decorative />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-2xl font-black uppercase tracking-widest text-blob-black">
                  Profil professionnel
                </h1>
                <BlobBadge variant="dark">Pro</BlobBadge>
              </div>
              <p className="mt-2 text-sm leading-6 text-blob-black/72">
                Gère les informations visibles par les riders.
              </p>
            </div>
          </div>
          <BlobButton asChild variant="yellowSignalDark" size="sm" className="w-full sm:w-auto" data-testid="preview-button">
          <Link href="/pro/profile/preview">
            <Eye className="h-4 w-4" />
            Voir mon profil
          </Link>
          </BlobButton>
        </div>
      </BlobCard>

      {loading ? (
        <BlobAlert title="Chargement">
          Chargement de ton profil pro...
        </BlobAlert>
      ) : (
        <>
          <Card className="overflow-hidden rounded-sm border-2 border-blob-sand-deep bg-white text-blob-black dark:border-white/10 dark:bg-[hsl(220_14%_14%)] dark:text-white">
            <CardHeader className="border-b-2 border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5">
              <CardTitle className="text-xl font-black uppercase tracking-widest text-blob-black dark:text-white">Mes infos pro</CardTitle>
              <CardDescription className="mt-1 text-blob-black/64 dark:text-white/60">Ces informations seront visibles par les riders.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="mb-4 rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 px-4 py-3 text-sm text-blob-black dark:bg-blob-yellow/10 dark:text-white">
                {PRO_BETA_INFO_MESSAGE}
              </div>
              <form onSubmit={onSave} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="businessName">Nom commercial</Label>
                  <Input
                    id="businessName"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Ex: BlobPro School"
                    maxLength={100}
                    className="min-h-11 rounded-sm border-2 border-blob-black/30 focus-visible:ring-blob-yellow"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bio">Présentation</Label>
                  <Textarea
                    id="bio"
                    value={bio}
                    onChange={(e)=>setBio(e.target.value)}
                    placeholder="Ce que tu proposes, ton expérience, ton spot préféré…"
                    maxLength={500}
                    className="min-h-32 rounded-sm border-2 border-blob-black/30 focus-visible:ring-blob-yellow"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Photo/Logo</Label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={onPick}
                    aria-label="Sélectionner une photo de profil"
                    className="block min-h-11 w-full rounded-sm border-2 border-blob-black/30 bg-white px-3 py-2 text-sm text-blob-black file:mr-3 file:rounded-sm file:border-0 file:bg-blob-black file:px-3 file:py-2 file:text-xs file:font-black file:uppercase file:tracking-widest file:text-white"
                  />
                  {photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoUrl}
                      alt="Aperçu de la photo de profil"
                      className="h-32 w-32 rounded-sm border-2 border-blob-black object-cover"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
                {err && (
                  <BlobAlert variant="error" title="Erreur">
                    <p>{err}</p>
                  </BlobAlert>
                )}
                <BlobButton
                  type="submit"
                  disabled={saving}
                  className="w-full sm:w-auto"
                >
                  {saving ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner />
                      Enregistrement…
                    </span>
                  ) : (
                    'Enregistrer'
                  )}
                </BlobButton>
              </form>
            </CardContent>
          </Card>

          {/* Security Section */}
          <ChangePasswordCard />

          {/* RGPD & Privacy Section */}
          <Card className="overflow-hidden rounded-sm border-2 border-blob-sand-deep bg-white text-blob-black dark:border-white/10 dark:bg-[hsl(220_14%_14%)] dark:text-white">
            <CardHeader className="border-b-2 border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5">
              <CardTitle className="text-base font-black uppercase tracking-widest text-blob-black dark:text-white">Confidentialité &amp; RGPD</CardTitle>
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
                    <div className="space-y-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="flex items-start gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                          <MapPin className="h-4 w-4" />
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-black uppercase tracking-wide text-blob-black dark:text-white">
                            Position active
                          </p>
                          <p className="mt-1 text-xs text-blob-black/64 dark:text-white/60">
                            Lat: {userLocation.lat.toFixed(2)}, Lng: {userLocation.lng.toFixed(2)}
                          </p>
                          <p className="mt-2 text-xs italic text-blob-black/64 dark:text-white/60">
                            Précision approximative (~1 km) pour préserver votre confidentialité
                          </p>
                          <p className="text-xs text-blob-black/64 dark:text-white/60">
                            Utilisée pour apparaître dans les recherches à proximité sur la BloboMap
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label htmlFor="profileRadiusKm" className="text-sm font-medium whitespace-nowrap">
                          Rayon de recherche :
                        </label>
                        <Input
                          id="profileRadiusKm"
                          type="number"
                          min={1}
                          max={200}
                          value={radiusKm}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v)) setRadiusKm(Math.max(1, Math.min(200, v)));
                          }}
                          className="w-20 rounded-sm border-2 border-blob-black/30 text-center focus-visible:ring-blob-yellow"
                        />
                        <span className="text-sm text-blob-black/64 dark:text-white/60">
                          {savingRadius ? 'km (sauvegarde…)' : 'km'}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={handleUpdateLocation}
                          disabled={updatingLocation || deletingLocation}
                          className="w-full rounded-sm border-2 border-blob-black text-blob-black hover:bg-blob-sand sm:w-auto dark:border-white/70 dark:text-white dark:hover:bg-white/10"
                        >
                          <RefreshCw className="h-3 w-3 mr-2" />
                          {updatingLocation ? 'Mise à jour…' : 'Actualiser ma position'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={handleDeleteLocation}
                          disabled={deletingLocation || updatingLocation}
                          className="w-full rounded-sm border-2 border-blob-black text-blob-black hover:bg-blob-sand sm:w-auto dark:border-white/70 dark:text-white dark:hover:bg-white/10"
                        >
                          <Trash2 className="h-3 w-3 mr-2" />
                          {deletingLocation ? 'Suppression...' : 'Supprimer ma position'}
                        </Button>
                      </div>
                      {geolocPermissionDenied && (
                        <p className="text-xs text-destructive">
                          Permission refusée — autorise la géolocalisation dans les paramètres de ton navigateur, puis réessaie.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-sm border-2 border-dashed border-blob-sand-deep bg-blob-sand p-4 dark:border-white/10 dark:bg-white/5">
                      <p className="flex items-start gap-2 text-sm text-blob-black/64 dark:text-white/60">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blob-black dark:text-white" />
                        <span>Aucune géolocalisation enregistrée. Active-la pour apparaître dans les recherches à proximité.</span>
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleUpdateLocation}
                        disabled={updatingLocation}
                        className="w-full rounded-sm border-2 border-blob-black text-blob-black hover:bg-blob-sand sm:w-auto dark:border-white/70 dark:text-white dark:hover:bg-white/10"
                      >
                        <MapPin className="h-3 w-3 mr-2" />
                        {updatingLocation ? 'Localisation en cours…' : 'Activer ma géolocalisation'}
                      </Button>
                      {geolocPermissionDenied && (
                        <p className="text-xs text-destructive">
                          Permission refusée — autorise la géolocalisation dans les paramètres de ton navigateur, puis réessaie.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <hr className="border-t-2" />

                {/* Cookie Preferences Section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Cookie className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Préférences de confidentialité</h3>
                  </div>
                  {consentStateReady ? (
                    <div className="space-y-3">
                      <div className={`flex items-start gap-3 rounded-sm border-2 p-4 ${consentSummary.cardClasses}`}>
                        <consentSummary.Icon className={`h-5 w-5 ${consentSummary.iconClasses} flex-shrink-0 mt-0.5`} />
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-black uppercase tracking-wide text-blob-black dark:text-white">{consentSummary.label}</p>
                            {consentSummary.badge && (
                              <Badge className={consentSummary.badge.className}>{consentSummary.badge.text}</Badge>
                            )}
                          </div>
                          <p className="text-xs text-blob-black/64 dark:text-white/60">{consentSummary.description}</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleReopenCookieConsent}
                        className="w-full rounded-sm border-2 border-blob-black text-blob-black hover:bg-blob-sand sm:w-auto dark:border-white/70 dark:text-white dark:hover:bg-white/10"
                      >
                        Gérer mes préférences
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-sm border-2 border-dashed border-blob-sand-deep p-4 text-sm text-blob-black/64 dark:border-white/10 dark:text-white/60">
                      Chargement des préférences…
                    </div>
                  )}
                </div>

                <hr className="border-t-2" />

                {/* Alert preferences */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Préférences d&apos;alertes</h3>
                  </div>
                  {loadingNotifPrefs ? (
                    <div className="rounded-sm border-2 border-dashed border-blob-sand-deep p-4 text-sm text-blob-black/64 dark:border-white/10 dark:text-white/60">
                      Chargement des préférences…
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Email alerts */}
                      <div className="space-y-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4 dark:border-white/10 dark:bg-white/5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                              <Mail className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <label htmlFor="emailNotifToggle" className="cursor-pointer text-sm font-black uppercase tracking-wide">
                                Alertes par email
                              </label>
                              <p className="text-xs text-blob-black/64 dark:text-white/60" id="emailNotif-desc">
                                Reçois un email quand un rider t&apos;envoie une demande, même si tu n&apos;es pas connecté.
                              </p>
                            </div>
                          </div>
                          <button
                            id="emailNotifToggle"
                            type="button"
                            onClick={() => setEmailNotif((v) => !v)}
                            aria-pressed={emailNotif}
                            aria-describedby="emailNotif-desc emailNotif-help"
                            className={toggleTrackClass(emailNotif)}
                            aria-label={emailNotif ? 'Désactiver les alertes email' : 'Activer les alertes email'}
                          >
                            <span className={toggleThumbClass(emailNotif)} />
                          </button>
                        </div>
                        <p id="emailNotif-help" className="text-xs leading-relaxed text-blob-black/70 dark:text-white/68">
                          Blob n&apos;envoie jamais ton adresse email au rider. Ces emails servent uniquement à te prévenir qu&apos;une demande t&apos;attend dans ton espace pro. Ils ne remplacent pas les alertes dans Blob.
                        </p>
                        {emailNotif && (
                          <p className="text-xs font-black uppercase tracking-wide text-blob-black dark:text-white">
                            Activé — tu recevras un email pour chaque nouvelle demande pertinente.
                          </p>
                        )}
                      </div>

                      {/* Channel masters: in-app + push */}
                      <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                            <Bell className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <h4 className="text-sm font-black uppercase tracking-wide" id="inapp-toggle-label">Dans Blob (cloche)</h4>
                            <p className="text-xs text-blob-black/64 dark:text-white/60" id="inapp-toggle-desc">
                              Le badge et l&apos;historique de notifications, visibles quand tu ouvres Blob.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleNotificationPref('inAppEnabled')}
                          aria-pressed={notificationPrefs.inAppEnabled}
                          aria-labelledby="inapp-toggle-label"
                          aria-describedby="inapp-toggle-desc"
                          className={toggleTrackClass(notificationPrefs.inAppEnabled)}
                          aria-label={notificationPrefs.inAppEnabled ? 'Désactiver les notifications dans Blob' : 'Activer les notifications dans Blob'}
                        >
                          <span className={toggleThumbClass(notificationPrefs.inAppEnabled)} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                            <Bell className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <h4 className="text-sm font-black uppercase tracking-wide" id="push-toggle-label">Push (téléphone / navigateur)</h4>
                            <p className="text-xs text-blob-black/64 dark:text-white/60" id="push-toggle-desc">
                              Reçois ces alertes sur ton appareil, même quand Blob est fermé. Nécessite l&apos;autorisation de ton navigateur.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleNotificationPref('pushEnabled')}
                          aria-pressed={notificationPrefs.pushEnabled}
                          aria-labelledby="push-toggle-label"
                          aria-describedby="push-toggle-desc"
                          className={toggleTrackClass(notificationPrefs.pushEnabled)}
                          aria-label={notificationPrefs.pushEnabled ? 'Désactiver les notifications push' : 'Activer les notifications push'}
                        >
                          <span className={toggleThumbClass(notificationPrefs.pushEnabled)} />
                        </button>
                      </div>

                      <BrowserPushControl />

                      {/* ── PRO-specific event toggles (apply to enabled channels) ─ */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-black uppercase tracking-widest text-blob-black/60 dark:text-white/55">Activité professionnelle</h4>
                        <p className="text-xs text-blob-black/64 dark:text-white/60">Ces événements te sont notifiés sur les canaux activés ci-dessus.</p>

                        {/* Lesson Requests */}
                        <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-white p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                              <MapPin className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-black uppercase tracking-wide" id="notifyLesson-label">Demandes de cours (BloboMap)</p>
                              <p className="text-xs text-blob-black/64 dark:text-white/60" id="notifyLesson-desc">
                                Sois alerté lorsqu&apos;un rider t&apos;envoie une demande liée à un cours ou un accompagnement.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyLessonRequests')}
                            aria-pressed={notificationPrefs.notifyLessonRequests}
                            aria-labelledby="notifyLesson-label"
                            aria-describedby="notifyLesson-desc"
                            className={toggleTrackClass(notificationPrefs.notifyLessonRequests, false, 'sm')}
                          >
                            <span className={toggleThumbClass(notificationPrefs.notifyLessonRequests, 'sm')} />
                          </button>
                        </div>

                        {/* PRO Messages */}
                        <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-white p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                              <MessageSquare className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-black uppercase tracking-wide" id="notifyMessages-label">Messages</p>
                              <p className="text-xs text-blob-black/64 dark:text-white/60" id="notifyMessages-desc">
                                Sois alerté lorsqu&apos;un rider t&apos;écrit dans la messagerie Blob.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyProMessages')}
                            aria-pressed={notificationPrefs.notifyProMessages}
                            aria-labelledby="notifyMessages-label"
                            aria-describedby="notifyMessages-desc"
                            className={toggleTrackClass(notificationPrefs.notifyProMessages, false, 'sm')}
                          >
                            <span className={toggleThumbClass(notificationPrefs.notifyProMessages, 'sm')} />
                          </button>
                        </div>
                      </div>

                      {/* ── Sport filters ─────────────────────────────────── */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-black uppercase tracking-widest text-blob-black/60 dark:text-white/55">Filtres par sport</h4>

                        {/* Surf */}
                        <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-white p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                              <Waves className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-black uppercase tracking-wide" id="notifySurf-label">Demandes Surf</p>
                              <p className="text-xs text-blob-black/64 dark:text-white/60" id="notifySurf-desc">
                                Sois alerté pour les demandes liées au surf.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyForSurf')}
                            disabled={!notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests}
                            aria-pressed={notificationPrefs.notifyForSurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests}
                            aria-labelledby="notifySurf-label"
                            aria-describedby="notifySurf-desc"
                            className={toggleTrackClass(
                              notificationPrefs.notifyForSurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests,
                              !notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests,
                              'sm',
                            )}
                          >
                            <span className={toggleThumbClass(notificationPrefs.notifyForSurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests, 'sm')} />
                          </button>
                        </div>

                        {/* Kitesurf */}
                        <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-white p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                              <Wind className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-black uppercase tracking-wide" id="notifyKitesurf-label">Demandes Kitesurf</p>
                              <p className="text-xs text-blob-black/64 dark:text-white/60" id="notifyKitesurf-desc">
                                Sois alerté pour les demandes liées au kitesurf.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyForKitesurf')}
                            disabled={!notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests}
                            aria-pressed={notificationPrefs.notifyForKitesurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests}
                            aria-labelledby="notifyKitesurf-label"
                            aria-describedby="notifyKitesurf-desc"
                            className={toggleTrackClass(
                              notificationPrefs.notifyForKitesurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests,
                              !notificationPrefs.pushEnabled || !notificationPrefs.notifyLessonRequests,
                              'sm',
                            )}
                          >
                            <span className={toggleThumbClass(notificationPrefs.notifyForKitesurf && notificationPrefs.pushEnabled && notificationPrefs.notifyLessonRequests, 'sm')} />
                          </button>
                        </div>
                      </div>

                      {/* Info box when in-app alerts are disabled */}
                      {!notificationPrefs.pushEnabled && (
                        <div className="rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 p-3 text-blob-black dark:bg-blob-yellow/10 dark:text-white" role="status">
                          <div className="flex items-start gap-2">
                            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <div className="flex-1">
                              <p className="text-xs font-black uppercase tracking-wide">Alertes dans Blob désactivées</p>
                              <p className="mt-0.5 text-xs text-blob-black/72 dark:text-white/72">
                                Réactive les alertes dans Blob pour voir les messages et demandes de cours. Les alertes email fonctionnent indépendamment.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Save button */}
                      <BlobButton
                        type="button"
                        variant="outlineDark"
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
                          'Sauvegarder mes préférences'
                        )}
                      </BlobButton>
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
                    <BlobButton asChild variant="outlineDark" size="sm">
                      <Link href="/about">
                        <FileText className="h-3.5 w-3.5 mr-2" />
                        Politique RGPD
                      </Link>
                    </BlobButton>
                    <BlobButton
                      variant="outlineDark"
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
                      <FileText className="h-3.5 w-3.5 mr-2" />
                      Exporter mes données
                    </BlobButton>
                    {deletionStatus?.isScheduled ? (
                      <BlobButton
                        variant="outlineDark"
                        size="sm"
                        type="button"
                        onClick={handleCancelDeletion}
                        disabled={loadingDeletion}
                      >
                        Annuler suppression ({deletionStatus.daysRemaining}j)
                      </BlobButton>
                    ) : (
                      <BlobButton
                        variant="outlineDark"
                        size="sm"
                        type="button"
                        onClick={() => setShowDeletionModal(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Supprimer mon compte
                      </BlobButton>
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
            className="max-w-lg w-full overflow-hidden rounded-sm border-2 border-blob-black bg-white text-blob-black shadow-2xl dark:border-white/20 dark:bg-[hsl(220_14%_14%)] dark:text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="border-b-2 border-blob-sand-deep bg-blob-sand dark:border-white/10 dark:bg-white/5">
              <CardTitle className="text-xl font-black uppercase tracking-widest text-blob-black dark:text-white">Suppression de compte</CardTitle>
              <CardDescription className="text-blob-black/70 dark:text-white/68">
                Cette action entraînera la suppression définitive de votre compte dans 30 jours
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-blob-black dark:text-white" />
                  <h3 className="text-sm font-black uppercase tracking-wide text-blob-black dark:text-white">Comment fonctionne la suppression ?</h3>
                </div>
                <ol className="list-inside list-decimal space-y-1 text-sm text-blob-black/72 dark:text-white/70">
                  <li>Votre compte sera <strong>immédiatement désactivé</strong></li>
                  <li>Vos données seront <strong>conservées pendant 30 jours</strong></li>
                  <li>Vous pourrez <strong>annuler</strong> la suppression durant cette période</li>
                  <li>Après 30 jours, vos données seront <strong>définitivement supprimées</strong></li>
                </ol>
              </div>

              <div className="space-y-2 rounded-sm border-2 border-blob-yellow-dark bg-blob-yellow/20 p-4 text-blob-black dark:bg-blob-yellow/10 dark:text-white">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" />
                  <h3 className="text-sm font-black uppercase tracking-wide">Avant de supprimer</h3>
                </div>
                <ul className="list-inside list-disc space-y-1 text-sm text-blob-black/72 dark:text-white/72">
                  <li>Vous pouvez <strong>exporter vos données</strong> (droit RGPD)</li>
                  <li>Pensez à <strong>clôturer vos offres</strong> en cours</li>
                  <li>Vos messages seront supprimés définitivement</li>
                </ul>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
                <BlobButton
                  type="button"
                  variant="outlineDark"
                  className="flex-1"
                  onClick={() => setShowDeletionModal(false)}
                  disabled={loadingDeletion}
                >
                  Annuler
                </BlobButton>
                <BlobButton
                  type="button"
                  variant="dark"
                  className="flex-1"
                  onClick={handleRequestDeletion}
                  disabled={loadingDeletion}
                >
                  {loadingDeletion ? 'Traitement...' : 'Confirmer la suppression'}
                </BlobButton>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/**
 * Per-browser push subscription control.
 *
 * Distinct from the global "Push" preference toggle above: that preference says
 * whether the pro *wants* push at all, while this control registers/removes the
 * FCM token for *this specific browser*. Permission is requested only on click —
 * never on load. All failures are surfaced as neutral messages.
 */
function BrowserPushControl() {
  const toast = useToast();
  const {
    isSupported,
    permission,
    accountHasPush,
    thisBrowserActive,
    backendAvailable,
    isStatusLoading,
    isLoading,
    subscribe,
    unsubscribe,
  } =
    usePushNotifications();

  if (!isSupported) {
    return (
      <BlobAlert variant="info">
        Ce navigateur ne gère pas les notifications push. Tu peux quand même garder tes alertes « Dans Blob ».
      </BlobAlert>
    );
  }

  if (permission === 'denied') {
    return (
      <BlobAlert variant="warning">
        Notifications bloquées dans ce navigateur. Pour activer ce poste, autorise les notifications dans les réglages de ton navigateur, puis reviens ici.
      </BlobAlert>
    );
  }

  if (isStatusLoading && backendAvailable === null) {
    return (
      <BlobAlert variant="info">
        Vérification de la disponibilité des notifications push...
      </BlobAlert>
    );
  }

  if (backendAvailable !== true) {
    return (
      <BlobAlert variant="info">
        Notifications push indisponibles pour le moment. Tu peux quand même garder tes alertes « Dans Blob ».
      </BlobAlert>
    );
  }

  const handleEnable = async () => {
    const ok = await subscribe();
    toast(
      ok
        ? 'Ce navigateur recevra désormais les notifications push.'
        : "Impossible d'activer ce navigateur pour le moment.",
      ok ? 'success' : 'error',
    );
  };

  const handleDisable = async () => {
    const ok = await unsubscribe();
    toast(
      ok
        ? 'Ce navigateur ne recevra plus de notifications push.'
        : "Impossible de désactiver ce navigateur pour le moment.",
      ok ? 'success' : 'error',
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-sm border-2 border-dashed border-blob-sand-deep bg-blob-sand p-4 dark:border-white/10 dark:bg-white/5">
      {accountHasPush !== null && (
        <p className="text-xs text-blob-black/64 dark:text-white/60">
          Notifications push sur le compte :{' '}
          <span className="font-semibold">{accountHasPush ? 'activées' : 'désactivées'}</span>
          {accountHasPush ? ' (au moins un appareil).' : '.'}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-black uppercase tracking-wide text-blob-black dark:text-white">Ce navigateur</h4>
          <p className="text-xs text-blob-black/64 dark:text-white/60">
            {thisBrowserActive
              ? 'Ce navigateur est configuré pour recevoir les notifications push.'
              : "Active ce navigateur pour recevoir les notifications push ici."}
          </p>
        </div>
        <BlobButton
          type="button"
          variant="outlineDark"
          size="sm"
          onClick={thisBrowserActive ? handleDisable : handleEnable}
          disabled={isLoading}
          className="w-full sm:w-auto"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <Spinner />
              …
            </span>
          ) : thisBrowserActive ? (
            'Désactiver ce navigateur'
          ) : (
            'Activer ce navigateur'
          )}
        </BlobButton>
      </div>
    </div>
  );
}
