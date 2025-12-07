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
import { MapPin, Cookie, FileText, Trash2, Target, Shield, Ban, BookOpen, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DisciplinePreference, Gender, UserProfile } from '@/types/user';
import type { Level } from '@/types/matching';
import { COOKIE_CONSENT_REOPEN_EVENT, useCookieConsent } from '../../components/cookies/CookieConsent';
import { ChangePasswordCard } from './ChangePasswordCard';

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
  photoUrl?: string | null;
  blobosphereContributor?: boolean;
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
        description: 'Annonces générales sans profilage ; aucune donnée personnelle n’est utilisée pour la personnalisation.',
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
  const [blobosphereContributor, setBlobosphereContributor] = useState<boolean>(false);

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
        setBlobosphereContributor(Boolean(profile.blobosphereContributor));
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
    if (!confirm('Supprimer votre géolocalisation ? Vous devrez la réactiver pour utiliser le matching et voir les offres à proximité.')) {
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
      const tokens = apiClient.getTokens();
      if (!tokens?.accessToken) return;

      const response = await apiRequest('/profile/deletion-status', {
        method: 'GET',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
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
      const tokens = apiClient.getTokens();
      if (!tokens?.accessToken) {
        toast('Session expirée, veuillez vous reconnecter', 'error');
        return;
      }

      const response = await apiRequest('/profile/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
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
      const tokens = apiClient.getTokens();
      if (!tokens?.accessToken) {
        toast('Session expirée, veuillez vous reconnecter', 'error');
        return;
      }

      const response = await apiRequest('/profile/cancel-deletion', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
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
      photoUrl: photoUrl || undefined,
      blobosphereContributor,
    };

    try {
      const tokens = apiClient.getTokens();
      if (!tokens?.accessToken) {
        throw new Error('Session expirée, veuillez vous reconnecter.');
      }

      if (photoFile) {
        const contentType = photoFile.type || 'image/jpeg';
        const uploadResponse = await apiRequest('/profile/photo/upload-url', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          body: JSON.stringify({ contentType }),
        });
        if (!uploadResponse.ok) {
          throw new Error('Impossible de préparer le téléversement');
        }
        const uploadData = (await uploadResponse.json()) as { uploadUrl: string; fileUrl?: string };
        const putResponse = await fetch(uploadData.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: photoFile,
        });
        if (!putResponse.ok) {
          throw new Error('Échec du téléversement');
        }
        if (uploadData.fileUrl) {
          payload.photoUrl = uploadData.fileUrl;
          setPhotoUrl(uploadData.fileUrl);
        }
        setPhotoPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return null;
        });
        setPhotoFile(null);
      }

      await apiClient.updateProfile(payload);

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
      const hasPhoto = Boolean(payload.photoUrl ?? photoUrl);
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
                  <div className="relative h-48 w-36 sm:h-56 sm:w-44 overflow-hidden rounded-lg bg-muted">
                    {displayedPhotoSrc ? (
                      <Image
                        src={displayedPhotoSrc}
                        alt={photoAlt}
                        fill
                        className="object-cover"
                        sizes="(min-width: 640px) 176px, 144px"
                        unoptimized
                      />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Aperçu</span>
                    )}
                  </div>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickPhoto}
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground hover:file:bg-secondary/80"
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
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/80 px-3 py-2 text-sm text-amber-900">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>Sans photo, l’accès au matching reste bloqué. Ajoute une nouvelle photo pour débloquer la sélection.</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="w-full">
                  <Label htmlFor="sex">Sexe</Label>
                  <select
                    id="sex"
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={sex}
                    onChange={(event) => setSex(event.target.value as SexOption)}
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
                <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={surfLevel} onChange={(event) => setSurfLevel(event.target.value as LevelOption)}>
                  <option value="">— Aucun —</option>
                  <option value="beginner">Débutant</option>
                  <option value="intermediate">Intermédiaire</option>
                  <option value="advanced">Confirmé</option>
                </select>
              </div>
              <div>
                <Label>Kitesurf</Label>
                <select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={kiteLevel} onChange={(event) => setKiteLevel(event.target.value as LevelOption)}>
                  <option value="">— Aucun —</option>
                  <option value="beginner">Débutant</option>
                  <option value="intermediate">Intermédiaire</option>
                  <option value="advanced">Confirmé</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notifications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            <div className="flex items-center gap-2">
              <input id="emailNotif" type="checkbox" checked={emailNotif} onChange={(e) => setEmailNotif(e.target.checked)} />
              <Label htmlFor="emailNotif" className="!m-0">
                Recevoir des emails lorsqu’un partenaire cherche à me joindre
              </Label>
            </div>

          </CardContent>
        </Card>

        <ChangePasswordCard />

        {/* Privacy and Data Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🔒 Confidentialité et Données</CardTitle>
            <CardDescription>Gérez vos données personnelles et préférences de confidentialité</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Geolocation Management */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Géolocalisation</h3>
              </div>
              {userLocation ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    📍 Position enregistrée : {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Utilisée pour le matching et la recherche d&apos;offres à proximité.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={handleDeleteLocation}
                    disabled={deletingLocation}
                  >
                    <Trash2 className="h-3 w-3 mr-2" />
                    {deletingLocation ? 'Suppression...' : 'Supprimer ma position'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    ℹ️ Aucune géolocalisation enregistrée. Vous pouvez l&apos;activer depuis les pages Matching ou Offres.
                  </p>
                </div>
              )}
            </div>

            <hr className="border-t" />

            {/* Cookie Preferences */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Cookie className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Préférences Cookies</h3>
              </div>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Modifiez vos choix concernant les cookies et le suivi.</p>
                {consentStateReady ? (
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
                    <div className={`flex flex-1 items-start gap-3 rounded-2xl border p-4 ${consentSummary.cardClasses}`}>
                      <consentSummary.Icon className={`h-5 w-5 ${consentSummary.iconClasses}`} />
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{consentSummary.label}</p>
                          {consentSummary.badge && (
                            <Badge className={consentSummary.badge.className}>{consentSummary.badge.text}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{consentSummary.description}</p>
                      </div>
                    </div>
                    <div className="lg:w-48">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleReopenCookieConsent}
                        className="w-full h-full"
                      >
                        Gérer mes cookies
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    Chargement des préférences en cours…
                  </div>
                )}
              </div>
            </div>

            <hr className="border-t" />

            {/* Blobosphère contribution */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Contribution Blobosphère</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Active cette option pour pouvoir proposer des sujets ou témoignages qui apparaîtront dans le module
                Blobosphère. Le consentement est vérifié par l’équipe avant publication.
              </p>
              <label className="flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={blobosphereContributor}
                  onChange={(e) => setBlobosphereContributor(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Je veux contribuer à la Blobosphère</span>
              </label>
            </div>

            <hr className="border-t" />

            {/* Legal Links & Data Rights */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Vos droits RGPD</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification, de suppression et de portabilité de vos données.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <Link href="/about" className="text-sm text-primary hover:underline">
                  📄 Politique RGPD
                </Link>
                <span className="text-muted-foreground">•</span>
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

                      const response = await apiRequest('/profile/export', {
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

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
              {saving ? (
                <span className="inline-flex items-center gap-2"><Spinner /> Enregistrement…</span>
              ) : (
                'Enregistrer'
              )}
            </Button>
          </div>
          {showDashboardShortcut && (
            <div className="rounded-lg border border-green-200 bg-green-50/70 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-green-900">Profil à jour ✅</p>
                <p className="text-sm text-green-800">Tu peux retourner sur le dashboard pour explorer les sessions et messages.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => router.push('/dashboard')}
              >
                Retourner au dashboard
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
                  <li>Pensez à <strong>annuler vos réservations</strong> en cours</li>
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
              Confirme la suppression de ta photo. Le matching restera inaccessible tant qu&rsquo;une nouvelle photo ne sera pas
              ajoutée.
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
