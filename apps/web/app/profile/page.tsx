"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { apiClient } from '../../lib/apiClient';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { useToast } from '../../components/ui/toast';
import { Spinner } from '../../components/ui/spinner';
import { apiRequest } from '../../lib/csrf';
import Link from 'next/link';
import { MapPin, Cookie, FileText, Trash2, Target, Shield, Ban, AlertTriangle, Camera, User, Waves, Bell, Settings, Sparkles, Eye } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DisciplinePreference, Gender, UserProfile, UserProfileUpdate } from '@/types/user';
import type { Level } from '@/types/matching';
import { COOKIE_CONSENT_REOPEN_EVENT, useCookieConsent } from '../../components/cookies/CookieConsent';
import { ChangePasswordCard } from '../../components/profile/ChangePasswordCard';

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
      cardClasses: string;
      iconClasses: string;
    };
    const baseBadge = 'border-none text-xs font-semibold';

    const summaries: Record<string, Summary> = {
      personalized: {
        label: 'Publicités personnalisées',
        description: 'Équipements sélectionnés selon ton niveau et tes spots favoris. Aide aussi à financer la plateforme.',
        Icon: Target,
        badge: { text: 'Recommandé', className: `${baseBadge} bg-blue-100 text-blue-700` },
        cardClasses: 'border-blue-200 bg-blue-50/70',
        iconClasses: 'text-blue-600',
      },
      essential: {
        label: 'Publicités basiques',
        description: 'Annonces générales sans profilage ; aucune donnée personnelle n\'est utilisée pour la personnalisation.',
        Icon: Shield,
        badge: { text: 'Essentiel', className: `${baseBadge} bg-emerald-100 text-emerald-700` },
        cardClasses: 'border-emerald-200 bg-emerald-50/70',
        iconClasses: 'text-emerald-600',
      },
      none: {
        label: 'Publicités limitées',
        description: 'Seules les annonces internes (House Ads) sont affichées, sans cookies publicitaires.',
        Icon: Ban,
        badge: { text: 'House ads', className: `${baseBadge} bg-slate-200 text-slate-700` },
        cardClasses: 'border-slate-200 bg-slate-50',
        iconClasses: 'text-slate-500',
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
      } catch (error) {
        console.error('Error loading notification preferences:', error);
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
      } catch (error) {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la suppression';
      toast(message, 'error');
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la suppression';
      toast(message, 'error');
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
    } catch (error) {
      console.error('Error checking deletion status:', error);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la demande';
      toast(message, 'error');
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de l\'annulation');
      }

      setDeletionStatus({ isScheduled: false });
      toast('Suppression de compte annulée avec succès', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de l\'annulation';
      toast(message, 'error');
    } finally {
      setLoadingDeletion(false);
    }
  };

  const handleReopenCookieConsent = async () => {
    if (!consentStateReady) {
      toast('Préférences cookies en cours de chargement, réessaie dans un instant.', 'info');
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
      } catch (error) {
        console.warn('Impossible de rouvrir immédiatement la fenêtre de consentement', error);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la sauvegarde';
      toast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-6 pb-24">
        <BackBar fallbackHref="/dashboard" />

        {/* Page Header */}
        <div className="flex items-center justify-between gap-3 pb-2 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
              <User className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Mon Profil</h1>
              <p className="text-sm text-muted-foreground">Personnalise ton profil pour un matching optimal</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="flex-shrink-0 gap-1.5">
            <Link href="/profile/preview">
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Voir mon profil</span>
              <span className="sm:hidden">Aperçu</span>
            </Link>
          </Button>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          {/* Section Identité */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-indigo-500" />
              <h2 className="text-lg font-semibold text-foreground">Identité</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Photo Card */}
              <Card className="overflow-hidden border-2 hover:shadow-lg transition-all bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
                      <Camera size={20}/>
                    </div>
                    <CardTitle>Photo de Profil</CardTitle>
                  </div>
                  <CardDescription>Ta photo visible dans le matching</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative group">
                      <div className="rounded-2xl border-4 border-indigo-300 p-1.5 bg-white dark:bg-slate-900">
                        <div className="relative h-56 w-44 overflow-hidden rounded-xl bg-muted">
                          {displayedPhotoSrc ? (
                            <Image
                              src={displayedPhotoSrc}
                              alt={photoAlt}
                              fill
                              className="object-cover"
                              sizes="176px"
                              unoptimized
                            />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 gap-2">
                              <Camera size={32} className="text-muted-foreground/40" />
                              <span className="text-xs text-muted-foreground">Aucune photo</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={onPickPhoto}
                      className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-indigo-600 file:to-violet-600 file:px-4 file:py-2.5 file:text-white file:font-medium hover:file:from-indigo-700 hover:file:to-violet-700 file:transition-all"
                    />
                    {(photoUrl || showPhotoWarning) && (
                      <div className="w-full space-y-2">
                        {photoUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setDeletePhotoModalOpen(true)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Supprimer la photo
                          </Button>
                        )}
                        {showPhotoWarning && (
                          <div className="flex items-start gap-2 rounded-lg border-2 border-amber-300 bg-amber-50/80 px-3 py-2.5 text-sm text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span>Sans photo, le matching est bloqué. Ajoute une photo pour débloquer !</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Nom & Bio Card */}
              <Card className="overflow-hidden border-2 hover:shadow-lg transition-all">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
                      <Sparkles size={20}/>
                    </div>
                    <div>
                      <CardTitle>Nom & Bio</CardTitle>
                      <CardDescription>Comment tu apparais dans le matching</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="displayName" className="flex items-center gap-2">
                      <span className="text-sm font-medium">Nom affiché</span>
                      <Badge variant="secondary" className="text-xs">Requis</Badge>
                    </Label>
                    <Input
                      id="displayName"
                      placeholder="Exemple : Blobmama"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sex">Sexe</Label>
                    <select
                      id="sex"
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    <Label htmlFor="bio">Ta présentation</Label>
                    <Textarea
                      id="bio"
                      placeholder="Exemple : Je surf depuis trois ans et je suis plutôt shortboard. Lève-tôt qui préfère les sessions matinales. Maman à mi-temps"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={4}
                      className="resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                      {bio.length}/1000 caractères
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Section Mes Glisses */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-cyan-500" />
              <h2 className="text-lg font-semibold text-foreground">Mes Glisses</h2>
            </div>
            <Card className="overflow-hidden border-2 hover:shadow-lg transition-shadow">
              <CardHeader className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/30 dark:to-blue-950/30">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 text-white">
                    <Waves size={20}/>
                  </div>
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      Disciplines & Niveaux
                      <Badge variant="secondary" className="text-xs">Au moins 1 requis</Badge>
                    </CardTitle>
                    <CardDescription>Sélectionne ton niveau pour trouver des partenaires adaptés</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-base font-medium">
                      Surf
                    </Label>
                    <select
                      className="h-11 w-full rounded-lg border-2 border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 transition-all"
                      value={surfLevel}
                      onChange={(event) => setSurfLevel(event.target.value as LevelOption)}
                    >
                      <option value="">— Aucun —</option>
                      <option value="beginner">Débutant</option>
                      <option value="intermediate">Intermédiaire</option>
                      <option value="advanced">Confirmé</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2 text-base font-medium">
                      Kitesurf
                    </Label>
                    <select
                      className="h-11 w-full rounded-lg border-2 border-input bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 transition-all"
                      value={kiteLevel}
                      onChange={(event) => setKiteLevel(event.target.value as LevelOption)}
                    >
                      <option value="">— Aucun —</option>
                      <option value="beginner">Débutant</option>
                      <option value="intermediate">Intermédiaire</option>
                      <option value="advanced">Confirmé</option>
                    </select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Section Sécurité */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-red-500" />
              <h2 className="text-lg font-semibold text-foreground">Sécurité</h2>
            </div>
            <ChangePasswordCard />
          </div>

          {/* Section Confidentialité & Données */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-slate-500" />
              <h2 className="text-lg font-semibold text-foreground">Confidentialité & Données</h2>
            </div>
            <Card className="border-2">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 text-white">
                    <Settings size={20}/>
                  </div>
                  <div>
                    <CardTitle>Mes Données Personnelles</CardTitle>
                    <CardDescription>Gestion RGPD et confidentialité</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">

                {/* Geolocation */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Géolocalisation</h3>
                  </div>
                  {userLocation ? (
                    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-emerald-600 text-lg">📍</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                            Position active
                          </p>
                          <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                            Lat: {userLocation.lat.toFixed(4)}, Lng: {userLocation.lng.toFixed(4)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">Utilisée pour le matching géolocalisé</p>
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
                    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 dark:bg-slate-900/20 p-4">
                      <p className="text-sm text-muted-foreground flex items-start gap-2">
                        <span>ℹ️</span>
                        <span>Aucune géolocalisation enregistrée. Active-la depuis Matching pour trouver des partenaires près de toi.</span>
                      </p>
                    </div>
                  )}
                </div>

                <hr className="border-t-2" />

                {/* Cookie Preferences */}
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
                            <p className="text-xs text-muted-foreground">Reçois des alertes instantanées sur tous tes appareils</p>
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

                      {/* Rider-specific preferences */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Messagerie & Matching</h4>

                        {/* Messages */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-cyan-300 dark:hover:border-cyan-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">💬</span>
                            <div>
                              <p className="text-sm font-medium">Messages</p>
                              <p className="text-xs text-muted-foreground">Quand tu reçois un nouveau message</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyMessages')}
                            disabled={!notificationPrefs.pushEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyMessages && notificationPrefs.pushEnabled
                                ? 'bg-cyan-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle message notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyMessages && notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* Matches */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-pink-300 dark:hover:border-pink-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🎉</span>
                            <div>
                              <p className="text-sm font-medium">Nouveaux matchs</p>
                              <p className="text-xs text-muted-foreground">Quand tu matches avec un autre rider</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyMatches')}
                            disabled={!notificationPrefs.pushEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyMatches && notificationPrefs.pushEnabled
                                ? 'bg-pink-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle match notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyMatches && notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* Group Invitations */}
                        <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">👥</span>
                            <div>
                              <p className="text-sm font-medium">Invitations groupe</p>
                              <p className="text-xs text-muted-foreground">Quand on t&apos;invite dans une conversation</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNotificationPref('notifyInvitations')}
                            disabled={!notificationPrefs.pushEnabled}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              notificationPrefs.notifyInvitations && notificationPrefs.pushEnabled
                                ? 'bg-indigo-600'
                                : 'bg-gray-300 dark:bg-gray-600'
                            } ${!notificationPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            aria-label="Toggle invitation notifications"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                notificationPrefs.notifyInvitations && notificationPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
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
                          // Auth via httpOnly cookie — no hint check, no Authorization header.
                          toast('Génération de l\'export en cours...', 'info');

                          const response = await apiRequest('/profile/export', {
                            method: 'GET',
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

              </CardContent>
            </Card>
          </div>

          {/* Bouton Sauvegarder */}
          <div className="space-y-4 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                💡 Pense à sauvegarder tes modifications avant de quitter
              </p>
              <Button
                type="submit"
                className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-lg hover:shadow-xl transition-all text-base px-8 py-6"
                disabled={saving}
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2"><Spinner /> Enregistrement…</span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Enregistrer mon profil
                  </span>
                )}
              </Button>
            </div>
            {showDashboardShortcut && (
              <div className="rounded-xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shadow-sm">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-emerald-900">Profil à jour ! ✅</p>
                    <p className="text-sm text-emerald-800">Tu peux retourner sur le dashboard pour explorer les sessions et messages.</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto border-emerald-300 hover:bg-emerald-100"
                  onClick={() => router.push('/dashboard')}
                >
                  Retour au dashboard →
                </Button>
              </div>
            )}
          </div>
        </form>

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
                <CardTitle className="text-xl text-red-600 flex items-center gap-2">
                  <AlertTriangle className="w-6 h-6" />
                  Suppression de compte
                </CardTitle>
                <CardDescription>
                  Cette action entraînera la suppression définitive de votre compte dans 30 jours
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 space-y-2">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <span>📅</span> Comment fonctionne la suppression ?
                  </h3>
                  <ol className="text-sm space-y-1.5 list-decimal list-inside text-muted-foreground">
                    <li>Votre compte sera <strong>immédiatement désactivé</strong></li>
                    <li>Vos données seront <strong>conservées pendant 30 jours</strong></li>
                    <li>Vous pourrez <strong>annuler</strong> la suppression durant cette période</li>
                    <li>Après 30 jours, vos données seront <strong>définitivement supprimées</strong></li>
                  </ol>
                </div>

                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 space-y-2">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <span>💡</span> Avant de supprimer
                  </h3>
                  <ul className="text-sm space-y-1.5 list-disc list-inside text-muted-foreground">
                    <li>Vous pouvez <strong>exporter vos données</strong> (droit RGPD)</li>
                    <li>Pensez à <strong>annuler vos réservations</strong> en cours</li>
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
                    className="flex-1"
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
                  </Button>
                </div>
              </CardContent>
            </Card>
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
            <Button type="button" variant="outline" onClick={() => setDeletePhotoModalOpen(false)} disabled={removingPhoto}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmDeletePhoto} disabled={removingPhoto}>
              {removingPhoto ? 'Suppression…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
