"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { apiClient } from '../../lib/apiClient';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { useToast } from '../../components/ui/toast';
import { Spinner } from '../../components/ui/spinner';
import { apiRequest } from '../../lib/csrf';
import Link from 'next/link';
import { MapPin, Cookie, FileText, Trash2, Target, Shield, Ban, AlertTriangle, Camera, Waves, Bell, Settings, Sparkles, Eye } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DisciplinePreference, Gender, UserProfile, UserProfileUpdate } from '@/types/user';
import type { Level } from '@/types/matching';
import { COOKIE_CONSENT_REOPEN_EVENT, useCookieConsent } from '../../components/cookies/CookieConsent';
import { ChangePasswordCard } from '../../components/profile/ChangePasswordCard';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobInput, BlobPageHeader } from '@/components/blob';
import { ProfilePhoto } from '@/components/media/ProfilePhoto';

type SexOption = 'Femme' | 'Homme' | 'Autre' | 'Ne pas préciser';
type LevelOption = '' | Level;

type DeletionStatus = {
  isScheduled: boolean;
  deletedAt?: string;
  deletionDate?: string;
  daysRemaining?: number;
};
type ProfileUpdatePayload = {
  displayName?: string;
  bio?: string;
  sex: Gender;
  emailNotif: boolean;
};

const PROFILE_PHOTO_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
const PROFILE_PHOTO_TYPES = new Set(PROFILE_PHOTO_ACCEPT.split(','));
const GENERIC_PROFILE_ERROR = 'Impossible de mettre à jour le profil pour le moment.';
const GENERIC_DELETE_ERROR = 'Impossible de traiter la suppression pour le moment.';
const GENERIC_EXPORT_ERROR = 'Impossible de générer l’export pour le moment.';
const GENERIC_NOTIFICATION_ERROR = 'Impossible de sauvegarder les préférences pour le moment.';
const GENERIC_PHOTO_ERROR = 'Impossible de traiter la photo pour le moment.';

const labelToGender = (label: SexOption): Gender => {
  switch (label) {
    case 'Femme':
      return 'FEMALE';
    case 'Homme':
      return 'MALE';
    case 'Autre':
      return 'OTHER';
    default:
      return 'UNSPECIFIED';
  }
};

const genderToLabel = (value?: Gender | null): SexOption => {
  switch (value) {
    case 'FEMALE':
      return 'Femme';
    case 'MALE':
      return 'Homme';
    case 'OTHER':
      return 'Autre';
    default:
      return 'Ne pas préciser';
  }
};

export default function ProfilePage() {
  const router = useRouter();
  const toast = useToast();
  const { updateConsent: resetConsent, consentReady: consentStateReady, consentLevel } = useCookieConsent();
  const consentSummary = useMemo(() => {
    type Summary = {
      label: string;
      description: string;
      Icon: LucideIcon;
      badge?: { text: string; className?: string };
      variant: 'yellow' | 'success' | 'sand';
    };

    const summaries: Record<string, Summary> = {
      personalized: {
        label: 'Expérience optimisée',
        description: 'Navigation adaptée à vos habitudes sur Blob, avec statistiques d\'usage enrichies.',
        Icon: Target,
        badge: { text: 'Recommandé' },
        variant: 'yellow',
      },
      essential: {
        label: 'Fonctionnel & mesure anonyme',
        description: 'Session, sécurité et statistiques d\'usage sans identification personnelle.',
        Icon: Shield,
        badge: { text: 'Actif' },
        variant: 'success',
      },
      none: {
        label: 'Essentiel uniquement',
        description: 'Cookies strictement nécessaires, sans aucune statistique d\'usage.',
        Icon: Ban,
        badge: { text: 'Minimal' },
        variant: 'sand',
      },
    };

    return summaries[consentLevel] ?? summaries.none;
  }, [consentLevel]);
  // Photo upload + preview
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [deletePhotoModalOpen, setDeletePhotoModalOpen] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [hasEverHadPhoto, setHasEverHadPhoto] = useState(false);

  const onPickPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!PROFILE_PHOTO_TYPES.has(file.type) || file.size > PROFILE_PHOTO_MAX_SIZE_BYTES) {
      event.target.value = '';
      toast('Photo refusée : utilise un fichier JPG, PNG ou WebP de 5 Mo maximum.', 'error');
      return;
    }
    setPhotoFile(file);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
  };

  // Form fields
  const [sex, setSex] = useState<SexOption>('Ne pas préciser');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [emailNotif, setEmailNotif] = useState<boolean>(false);

  // Notification preferences state
  const [notificationPrefs, setNotificationPrefs] = useState({
    pushEnabled: true,
    emailEnabled: false,
    notifyMessages: true,
    notifyMatches: true,
    notifyInvitations: true,
    emailDigestFrequency: 'NEVER',
  });
  const [loadingNotifPrefs, setLoadingNotifPrefs] = useState(true);
  const [savingNotifPrefs, setSavingNotifPrefs] = useState(false);

  // Geolocation state for privacy section
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [deletingLocation, setDeletingLocation] = useState(false);

  // Account deletion modal state
  const [showDeletionModal, setShowDeletionModal] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<DeletionStatus | null>(null);
  const [loadingDeletion, setLoadingDeletion] = useState(false);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  // Check deletion status on mount
  useEffect(() => {
    void checkDeletionStatus();
  }, []);

  // Load notification preferences on mount
  useEffect(() => {
    const loadNotificationPreferences = async () => {
      try {
        // Auth via httpOnly cookie — no hint check, no Authorization header.
        const response = await apiRequest('/profile/notifications', {
          method: 'GET',
        });

        if (response.ok) {
          const data = await response.json();
          if (data.preferences) {
            setNotificationPrefs((prev) => ({ ...prev, ...data.preferences }));
          }
        }
      } catch {
        // Preference loading is non-blocking for the profile page.
      } finally {
        setLoadingNotifPrefs(false);
      }
    };

    void loadNotificationPreferences();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async () => {
      try {
        const profile = (await apiClient.getProfile()) as UserProfile & {
          photoUrl?: string | null;
          lat?: number | null;
          lng?: number | null;
        };
        if (!isMounted) return;
        setDisplayName(profile.displayName ?? '');
        setBio(profile.bio ?? '');
        setSex(genderToLabel(profile.sex));
        setEmailNotif(Boolean(profile.emailNotif));
        setPhotoUrl(profile.photoUrl ?? null);
        setPhotoPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return null;
        });
        if (profile.lat != null && profile.lng != null) {
          setUserLocation({ lat: profile.lat, lng: profile.lng });
        } else {
          setUserLocation(null);
        }
      } catch {
        if (!isMounted) return;
        router.replace('/login');
      }
    };
    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    setHasEverHadPhoto((prev) => prev || Boolean(photoUrl));
  }, [photoUrl]);

  // Disciplines state
  const [surfLevel, setSurfLevel] = useState<LevelOption>('');
  const [kiteLevel, setKiteLevel] = useState<LevelOption>('');
  const [showDashboardShortcut, setShowDashboardShortcut] = useState(false);

  const displayedPhotoSrc = photoPreviewUrl ?? photoUrl;
  const photoAlt = useMemo(
    () => (displayName ? `Photo de ${displayName}` : 'Photo du profil'),
    [displayName],
  );
  const showPhotoWarning = hasEverHadPhoto && !photoPreviewUrl && !photoUrl;

  useEffect(() => {
    let isMounted = true;
    apiClient
      .getDisciplines()
      .then((items) => {
        if (!isMounted) return;
        const surf = items.find((discipline) => discipline.sport === 'surf');
        const kite = items.find((discipline) => discipline.sport === 'kitesurf');
        setSurfLevel(surf ? surf.level : '');
        setKiteLevel(kite ? kite.level : '');
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const [saving, setSaving] = useState(false);

  const handleDeleteLocation = async () => {
    if (!confirm('Supprimer votre géolocalisation ? Vous devrez la réactiver pour utiliser le matching géolocalisé.')) {
      return;
    }

    setDeletingLocation(true);
    try {
      await apiClient.updateProfile({ lat: undefined, lng: undefined });
      setUserLocation(null);
      toast('Géolocalisation supprimée', 'success');
    } catch {
      toast('Impossible de supprimer la géolocalisation pour le moment.', 'error');
    } finally {
      setDeletingLocation(false);
    }
  };

  const handleConfirmDeletePhoto = async () => {
    if (removingPhoto) return;
    setRemovingPhoto(true);
    try {
      await apiClient.updateProfile({ photoUrl: null });
      setPhotoUrl(null);
      setPhotoPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      setPhotoFile(null);
      toast('Photo supprimée. Ajoute une nouvelle photo pour réactiver le matching.', 'info');
      setDeletePhotoModalOpen(false);
    } catch {
      toast(GENERIC_PHOTO_ERROR, 'error');
    } finally {
      setRemovingPhoto(false);
    }
  };

  const checkDeletionStatus = async () => {
    try {
      // Auth via httpOnly cookie — no hint check, no Authorization header.
      const response = await apiRequest('/profile/deletion-status', {
        method: 'GET',
      });

      if (response.ok) {
        const data = await response.json();
        setDeletionStatus(data);
      }
    } catch {
      // Deletion status is shown only when available.
    }
  };

  const handleRequestDeletion = async () => {
    setLoadingDeletion(true);
    try {
      // Auth via httpOnly cookie — no hint check, no Authorization header.
      const response = await apiRequest('/profile/delete-account', {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error('DELETE_REQUEST_FAILED');
      }

      setDeletionStatus({
        isScheduled: true,
        deletedAt: data.deletedAt,
        deletionDate: data.deletionDate,
        daysRemaining: data.daysRemaining,
      });

      toast('Demande de suppression enregistrée. Vous avez 30 jours pour annuler.', 'success');
      setShowDeletionModal(false);
    } catch {
      toast(GENERIC_DELETE_ERROR, 'error');
    } finally {
      setLoadingDeletion(false);
    }
  };

  const handleCancelDeletion = async () => {
    setLoadingDeletion(true);
    try {
      // Auth via httpOnly cookie — no hint check, no Authorization header.
      const response = await apiRequest('/profile/cancel-deletion', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('DELETE_CANCEL_FAILED');
      }

      setDeletionStatus({ isScheduled: false });
      toast('Suppression de compte annulée avec succès', 'success');
    } catch {
      toast(GENERIC_DELETE_ERROR, 'error');
    } finally {
      setLoadingDeletion(false);
    }
  };

  const handleReopenCookieConsent = async () => {
    if (!consentStateReady) {
      toast('Préférences en cours de chargement, réessaie dans un instant.', 'info');
      return;
    }

    await resetConsent('none');

    document.cookie = 'cookie_consent=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

    if (typeof window !== 'undefined') {
      try {
        if ('localStorage' in window) {
          window.localStorage.removeItem('blob_consent');
          window.localStorage.removeItem('cookie-consent');
        }
        window.dispatchEvent(new Event(COOKIE_CONSENT_REOPEN_EVENT));
      } catch {
        window.location.reload();
      }
    }
  };

  const toggleNotificationPref = (key: keyof typeof notificationPrefs) => {
    setNotificationPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const saveNotificationPreferences = async () => {
    if (savingNotifPrefs) return;
    setSavingNotifPrefs(true);

    try {
      // Auth via httpOnly cookie — no hint check, no Authorization header.
      const response = await apiRequest('/profile/notifications', {
        method: 'PUT',
        body: JSON.stringify(notificationPrefs),
      });

      if (!response.ok) {
        throw new Error('NOTIFICATION_SAVE_FAILED');
      }

      toast('Préférences de notification sauvegardées', 'success');
    } catch {
      toast(GENERIC_NOTIFICATION_ERROR, 'error');
    } finally {
      setSavingNotifPrefs(false);
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setShowDashboardShortcut(false);

    const payload: ProfileUpdatePayload = {
      displayName: displayName || undefined,
      bio: bio || undefined,
      sex: labelToGender(sex),
      emailNotif,
    };

    let nextPhotoUrl = photoUrl;

    try {
      // Auth via httpOnly cookie — no hint check, no Authorization header.
      if (photoFile) {
        const contentType = photoFile.type || 'image/jpeg';
        const uploadResponse = await apiRequest('/profile/photo/upload-url', {
          method: 'POST',
          body: JSON.stringify({ contentType }),
        });
        if (!uploadResponse.ok) {
          throw new Error('Impossible de préparer le téléversement');
        }
        const uploadData = (await uploadResponse.json()) as { uploadUrl: string; key: string; fileUrl?: string };
        const putResponse = await fetch(uploadData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: photoFile,
        });
        if (!putResponse.ok) {
          throw new Error('Échec du téléversement');
        }
        // Finalize: valide le contenu côté serveur et retourne la photoUrl officielle
        const finalizeResponse = await apiRequest('/profile/photo/finalize', {
          method: 'POST',
          body: JSON.stringify({ key: uploadData.key }),
        });
        if (!finalizeResponse.ok) {
          throw new Error('Échec de la validation de la photo');
        }
        const { photoUrl: finalizedUrl } = (await finalizeResponse.json()) as { photoUrl: string };
        // photoUrl est déjà sauvée en DB par /finalize — ne pas la repasser à updateProfile
        // (le schéma PUT /profile/me n'accepte que null, pas une string arbitraire)
        nextPhotoUrl = finalizedUrl;
        setPhotoUrl(finalizedUrl);
        setPhotoPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return null;
        });
        setPhotoFile(null);
      }

      await apiClient.updateProfile(payload satisfies UserProfileUpdate);

      const disciplinesPayload: DisciplinePreference[] = [];
      if (surfLevel) {
        disciplinesPayload.push({ sport: 'surf', level: surfLevel });
      }
      if (kiteLevel) {
        disciplinesPayload.push({ sport: 'kitesurf', level: kiteLevel });
      }
      await apiClient.setDisciplines(disciplinesPayload);

      const nextDisplayName = (payload.displayName ?? displayName ?? '').trim();
      const hasDisplayName = nextDisplayName.length > 0;
      const hasPhoto = Boolean(nextPhotoUrl);
      const hasDisciplines = disciplinesPayload.length > 0;

      toast('Profil sauvegardé', 'success');
      if (!hasDisplayName || !hasPhoto || !hasDisciplines) {
        setTimeout(() => router.push('/onboarding'), 1000);
      } else {
        setShowDashboardShortcut(true);
      }
    } catch {
      toast(GENERIC_PROFILE_ERROR, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-6 bg-blob-sand px-4 pb-24 pt-4 text-blob-black sm:px-6">
        <BackBar fallbackHref="/dashboard" />

        <div className="flex flex-col gap-4 border-b-2 border-blob-sand-deep pb-5 sm:flex-row sm:items-end sm:justify-between">
          <BlobPageHeader
            title="Mon Profil"
            subtitle="Personnalise ta cabine membre pour le matching."
            showSeparator
          />
          <BlobButton asChild variant="outlineDark" size="sm" className="w-full sm:w-auto">
            <Link href="/profile/preview">
              <Eye className="h-4 w-4" />
              Voir mon profil
            </Link>
          </BlobButton>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
              <h2 className="text-lg font-black uppercase tracking-widest">Identité</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BlobCard className="bg-white">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow">
                      <Camera size={20} />
                    </span>
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-widest">Photo de Profil</h3>
                      <p className="mt-1 text-sm text-blob-black/64">Visible dans le matching.</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    <div className="rounded-sm border-2 border-blob-black bg-blob-sand p-1.5">
                      <div className="relative h-56 w-44 overflow-hidden rounded-sm border-2 border-white bg-white">
                        {displayedPhotoSrc ? (
                          <ProfilePhoto
                            src={displayedPhotoSrc}
                            alt={photoAlt}
                            fill
                            className="object-cover"
                            fallbackClassName="absolute inset-0 flex items-center justify-center bg-white px-3 text-center text-blob-black/60"
                            sizes="176px"
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                            <Camera size={32} className="text-blob-black/35" />
                            <span className="text-xs font-medium text-blob-black/60">Aucune photo</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="w-full space-y-2">
                      <label
                        htmlFor="photo-upload"
                        className="flex w-full cursor-pointer items-center gap-3 rounded-sm border-2 border-blob-black bg-blob-black px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-blob-black/90"
                      >
                        <Camera className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {photoFile ? '✓ Photo sélectionnée' : photoUrl ? 'Changer ma photo' : 'Choisir une photo'}
                        </span>
                      </label>
                      <input
                        id="photo-upload"
                        type="file"
                        accept={PROFILE_PHOTO_ACCEPT}
                        onChange={onPickPhoto}
                        className="sr-only"
                      />
                      <p className="text-xs text-blob-black/56">JPG, PNG ou WebP. 5 Mo maximum.</p>
                    </div>
                    {(photoUrl || showPhotoWarning) && (
                      <div className="w-full space-y-2">
                        {photoUrl && (
                          <BlobButton
                            type="button"
                            variant="outlineDark"
                            size="sm"
                            className="w-full"
                            onClick={() => setDeletePhotoModalOpen(true)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Supprimer la photo
                          </BlobButton>
                        )}
                        {showPhotoWarning && (
                          <BlobAlert variant="warning">
                            Sans photo, le matching est bloqué. Ajoute une photo pour débloquer.
                          </BlobAlert>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </BlobCard>

              <BlobCard className="bg-white">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-sand">
                      <Sparkles size={20} />
                    </span>
                    <div>
                      <h3 className="text-xl font-black uppercase tracking-widest">Nom & Bio</h3>
                      <p className="mt-1 text-sm text-blob-black/64">Comment tu apparais dans le matching.</p>
                    </div>
                  </div>
                  <BlobInput
                    id="displayName"
                    label="Nom affiché"
                    placeholder="Ex : GlissDad, KookSurf, DadouKite..."
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    hint="Requis pour apparaître dans le matching."
                  />
                  <div className="space-y-2">
                    <label htmlFor="sex" className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/70">
                      Sexe
                    </label>
                    <select
                      id="sex"
                      className="h-11 w-full rounded-sm border-2 border-blob-black bg-white px-3 py-2 text-sm text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                      value={sex}
                      onChange={(event) => setSex(event.target.value as SexOption)}
                    >
                      <option>Femme</option>
                      <option>Homme</option>
                      <option>Autre</option>
                      <option>Ne pas préciser</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="bio" className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/70">
                      Ta présentation
                    </label>
                    <textarea
                      id="bio"
                      placeholder="Surfeur depuis 4 ans, je fais régulièrement Bordeaux - côte et je cherche quelqu'un pour partager le trajet et les sessions."
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={4}
                      className="w-full resize-none rounded-sm border-2 border-blob-black bg-white px-3 py-2 text-sm text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                    />
                    <p className="text-xs text-blob-black/56">{bio.length}/1000 caractères</p>
                  </div>
                </div>
              </BlobCard>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
              <h2 className="text-lg font-black uppercase tracking-widest">Mes Glisses</h2>
            </div>
            <BlobCard className="bg-white">
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-sand">
                    <Waves size={20} />
                  </span>
                  <div>
                    <h3 className="flex flex-wrap items-center gap-2 text-xl font-black uppercase tracking-widest">
                      Disciplines & Niveaux
                      <BlobBadge variant="yellow">Au moins 1 requis</BlobBadge>
                    </h3>
                    <p className="mt-1 text-sm text-blob-black/64">Sélectionne ton niveau pour trouver des partenaires adaptés.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/70">Surf</label>
                    <select
                      className="h-11 w-full rounded-sm border-2 border-blob-black bg-white px-4 py-2 text-sm text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                      value={surfLevel}
                      onChange={(event) => setSurfLevel(event.target.value as LevelOption)}
                    >
                      <option value="">- Aucun -</option>
                      <option value="beginner">Débutant</option>
                      <option value="intermediate">Intermédiaire</option>
                      <option value="advanced">Confirmé</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-[0.14em] text-blob-black/70">Kitesurf</label>
                    <select
                      className="h-11 w-full rounded-sm border-2 border-blob-black bg-white px-4 py-2 text-sm text-blob-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow"
                      value={kiteLevel}
                      onChange={(event) => setKiteLevel(event.target.value as LevelOption)}
                    >
                      <option value="">- Aucun -</option>
                      <option value="beginner">Débutant</option>
                      <option value="intermediate">Intermédiaire</option>
                      <option value="advanced">Confirmé</option>
                    </select>
                  </div>
                </div>
              </div>
            </BlobCard>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
              <h2 className="text-lg font-black uppercase tracking-widest">Sécurité</h2>
            </div>
            <ChangePasswordCard />
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-12 rounded-sm bg-blob-yellow" />
              <h2 className="text-lg font-black uppercase tracking-widest">Confidentialité & Données</h2>
            </div>
            <BlobCard className="bg-white">
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-black text-white">
                    <Settings size={20} />
                  </span>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-widest">Mes Données Personnelles</h3>
                    <p className="mt-1 text-sm text-blob-black/64">Gestion RGPD et confidentialité.</p>
                  </div>
                </div>

                <div className="space-y-3 border-t-2 border-blob-sand-deep pt-5">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blob-black/64" />
                    <h3 className="text-sm font-black uppercase tracking-widest">Géolocalisation</h3>
                  </div>
                  {userLocation ? (
                    <BlobAlert variant="success" title="Position active">
                      <p>Position approximative: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}.</p>
                      <p className="mt-1 text-xs">Utilisée pour le matching géolocalisé.</p>
                      <BlobButton
                        variant="outlineDark"
                        size="sm"
                        type="button"
                        onClick={handleDeleteLocation}
                        disabled={deletingLocation}
                        className="mt-3 w-full sm:w-auto"
                      >
                        <Trash2 className="h-3 w-3" />
                        {deletingLocation ? 'Suppression...' : 'Supprimer ma position'}
                      </BlobButton>
                    </BlobAlert>
                  ) : (
                    <BlobAlert variant="info">
                      Aucune géolocalisation enregistrée. Active-la depuis Matching pour trouver des partenaires près de toi.
                    </BlobAlert>
                  )}
                </div>

                <div className="space-y-3 border-t-2 border-blob-sand-deep pt-5">
                  <div className="flex items-center gap-2">
                    <Cookie className="h-4 w-4 text-blob-black/64" />
                    <h3 className="text-sm font-black uppercase tracking-widest">Préférences de confidentialité</h3>
                  </div>
                  {consentStateReady ? (
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-4">
                        <consentSummary.Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-blob-black" />
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-black uppercase tracking-widest">{consentSummary.label}</p>
                            {consentSummary.badge && (
                              <BlobBadge variant={consentSummary.variant}>{consentSummary.badge.text}</BlobBadge>
                            )}
                          </div>
                          <p className="text-xs text-blob-black/64">{consentSummary.description}</p>
                        </div>
                      </div>
                      <BlobButton
                        variant="outlineDark"
                        size="sm"
                        type="button"
                        onClick={handleReopenCookieConsent}
                        className="w-full sm:w-auto"
                      >
                        Gérer mes préférences
                      </BlobButton>
                    </div>
                  ) : (
                    <BlobAlert variant="info">Chargement des préférences...</BlobAlert>
                  )}
                </div>

                <div className="space-y-3 border-t-2 border-blob-sand-deep pt-5">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-blob-black/64" />
                    <h3 className="text-sm font-black uppercase tracking-widest">Préférences d&apos;alertes</h3>
                  </div>
                  {loadingNotifPrefs ? (
                    <BlobAlert variant="info">Chargement des préférences...</BlobAlert>
                  ) : (
                    <div className="space-y-4">
                      <NotificationToggle
                        label="Alertes dans Blob"
                        description="Choisis les alertes que tu veux recevoir dans Blob."
                        checked={notificationPrefs.pushEnabled}
                        onClick={() => toggleNotificationPref('pushEnabled')}
                      />
                      <div className="space-y-2">
                        <h4 className="text-xs font-black uppercase tracking-widest text-blob-black/56">Messagerie & Matching</h4>
                        <NotificationToggle
                          label="Messages"
                          description="Quand tu reçois un nouveau message."
                          checked={notificationPrefs.notifyMessages && notificationPrefs.pushEnabled}
                          disabled={!notificationPrefs.pushEnabled}
                          onClick={() => toggleNotificationPref('notifyMessages')}
                        />
                        <NotificationToggle
                          label="Nouveaux matchs"
                          description="Quand tu matches avec un autre rider."
                          checked={notificationPrefs.notifyMatches && notificationPrefs.pushEnabled}
                          disabled={!notificationPrefs.pushEnabled}
                          onClick={() => toggleNotificationPref('notifyMatches')}
                        />
                        <NotificationToggle
                          label="Invitations groupe"
                          description="Quand on t’invite dans une conversation."
                          checked={notificationPrefs.notifyInvitations && notificationPrefs.pushEnabled}
                          disabled={!notificationPrefs.pushEnabled}
                          onClick={() => toggleNotificationPref('notifyInvitations')}
                        />
                      </div>
                      {!notificationPrefs.pushEnabled && (
                        <BlobAlert variant="warning">
                          Réactive les alertes dans Blob pour voir les messages, matchs et invitations.
                        </BlobAlert>
                      )}
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

                <div className="space-y-3 border-t-2 border-blob-sand-deep pt-5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blob-black/64" />
                    <h3 className="text-sm font-black uppercase tracking-widest">Vos Droits RGPD</h3>
                  </div>
                  <p className="text-sm leading-6 text-blob-black/64">
                    Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification, de suppression et de portabilité de vos données.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <BlobButton asChild variant="outlineDark" size="sm">
                      <Link href="/about">
                        <FileText className="h-3.5 w-3.5" />
                        Politique RGPD
                      </Link>
                    </BlobButton>
                    <BlobButton
                      variant="outlineDark"
                      size="sm"
                      type="button"
                      onClick={async () => {
                        try {
                          // Auth via httpOnly cookie — no hint check, no Authorization header.
                          toast('Génération de l\'export en cours...', 'info');

                          const response = await apiRequest('/profile/export', {
                            method: 'GET',
                          });

                          if (!response.ok) {
                            throw new Error('EXPORT_FAILED');
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
                        } catch {
                          toast(GENERIC_EXPORT_ERROR, 'error');
                        }
                      }}
                    >
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
                        className="border-red-700 text-red-800 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer mon compte
                      </BlobButton>
                    )}
                  </div>
                </div>
              </div>
            </BlobCard>
          </section>

          <div className="space-y-4 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-blob-black/64">Pense à sauvegarder tes modifications avant de quitter.</p>
              <BlobButton
                type="submit"
                className="w-full sm:w-auto"
                disabled={saving}
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2"><Spinner /> Enregistrement...</span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Enregistrer mon profil
                  </span>
                )}
              </BlobButton>
            </div>
            {showDashboardShortcut && (
              <BlobAlert variant="success" title="Profil à jour">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p>Tu peux retourner sur le dashboard pour explorer les sessions et messages.</p>
                  <BlobButton
                    type="button"
                    variant="outlineDark"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => router.push('/dashboard')}
                  >
                    Retour au dashboard
                  </BlobButton>
                </div>
              </BlobAlert>
            )}
          </div>
        </form>

        {showDeletionModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowDeletionModal(false)}
          >
            <BlobCard
              className="w-full max-w-lg bg-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-4">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-widest text-red-800">
                    <AlertTriangle className="h-6 w-6" />
                    Suppression de compte
                  </h2>
                  <p className="mt-1 text-sm text-blob-black/64">
                    Cette action entraînera la suppression définitive de votre compte dans 30 jours.
                  </p>
                </div>

                <BlobAlert variant="warning" title="Fonctionnement">
                  <ol className="list-inside list-decimal space-y-1.5 text-sm">
                    <li>Votre compte sera <strong>immédiatement désactivé</strong></li>
                    <li>Vos données seront <strong>conservées pendant 30 jours</strong></li>
                    <li>Vous pourrez <strong>annuler</strong> la suppression durant cette période</li>
                    <li>Après 30 jours, vos données seront <strong>définitivement supprimées</strong></li>
                  </ol>
                </BlobAlert>

                <BlobAlert variant="info" title="Avant de supprimer">
                  <ul className="list-inside list-disc space-y-1.5 text-sm">
                    <li>Vous pouvez <strong>exporter vos données</strong> avant de lancer la demande</li>
                    <li>Pensez à <strong>annuler vos réservations</strong> en cours</li>
                    <li>Vos messages seront supprimés définitivement</li>
                  </ul>
                </BlobAlert>

                <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
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
                    className="flex-1 border-red-800 bg-red-700 hover:bg-red-800"
                    onClick={handleRequestDeletion}
                    disabled={loadingDeletion}
                  >
                    {loadingDeletion ? (
                      <span className="inline-flex items-center gap-2">
                        <Spinner /> Traitement...
                      </span>
                    ) : (
                      'Confirmer la suppression'
                    )}
                  </BlobButton>
                </div>
              </div>
            </BlobCard>
          </div>
        )}
      </div>

      <Dialog open={deletePhotoModalOpen} onOpenChange={setDeletePhotoModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer la photo de profil</DialogTitle>
            <DialogDescription>
              Confirme la suppression de ta photo. Le matching restera inaccessible tant qu&apos;une nouvelle photo ne sera pas ajoutée.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Sans photo de profil, les autres riders ne pourront plus te voir dans le matching. Ajoute-en une nouvelle dès que possible.
          </p>
          <DialogFooter className="mt-6">
            <BlobButton type="button" variant="outlineDark" onClick={() => setDeletePhotoModalOpen(false)} disabled={removingPhoto}>
              Annuler
            </BlobButton>
            <BlobButton type="button" variant="dark" className="border-red-800 bg-red-700 hover:bg-red-800" onClick={handleConfirmDeletePhoto} disabled={removingPhoto}>
              {removingPhoto ? 'Suppression…' : 'Supprimer'}
            </BlobButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NotificationToggle({
  label,
  description,
  checked,
  disabled = false,
  onClick,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-sm border-2 border-blob-sand-deep bg-white p-3">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.12em] text-blob-black">{label}</p>
        <p className="mt-1 text-xs text-blob-black/56">{description}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-sm border-2 border-blob-black transition-colors ${
          checked ? 'bg-blob-yellow' : 'bg-blob-sand-deep'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        aria-pressed={checked}
        aria-label={label}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-sm border-2 border-blob-black bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
