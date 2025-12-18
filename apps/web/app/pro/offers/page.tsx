"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { apiClient } from '../../../lib/apiClient';
import { Eye, Calendar } from 'lucide-react';
import type { Sport, Level } from '@/types/matching';
import type { EditableOffer, OfferStats } from '@/types/offers';
import type { DashboardUser } from '@/types/user';
import type { ProProfileData } from '@/types/pro';

const sportLabels: Record<Sport, string> = {
  surf: 'Surf',
  kitesurf: 'Kitesurf'
};

const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
  anytime: 'Peu importe'
};

type ApiProOffer = Omit<EditableOffer, 'hourlyRate'> & {
  hourlyRate: number | string;
  proProfileId?: string;
  stats?: OfferStats;
  createdAt?: string;
  updatedAt?: string;
};

const isApiProOffer = (value: unknown): value is ApiProOffer => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const data = value as Partial<ApiProOffer>;
  const hasBaseFields =
    typeof data.sport === 'string' &&
    typeof data.level === 'string' &&
    typeof data.title === 'string' &&
    typeof data.description === 'string' &&
    typeof data.isActive === 'boolean';

  if (!hasBaseFields) {
    return false;
  }

  return typeof data.hourlyRate === 'number' || typeof data.hourlyRate === 'string';
};

const extractProOffer = (payload: unknown): ApiProOffer | null => {
  if (isApiProOffer(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const withOffer = payload as { offer?: unknown; offers?: unknown };
    if (isApiProOffer(withOffer.offer)) {
      return withOffer.offer;
    }
    if (Array.isArray(withOffer.offers)) {
      const found = withOffer.offers.find(isApiProOffer);
      if (found) {
        return found;
      }
    }
  }

  return null;
};

export default function ProOffersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [offer, setOffer] = useState<EditableOffer>({
    sport: 'surf',
    level: 'beginner',
    title: '',
    description: '',
    hourlyRate: 50,
    isActive: true
  });

  const [fieldErrors, setFieldErrors] = useState<{
    title?: string;
    description?: string;
    hourlyRate?: string;
    geolocation?: string;
  }>({});

  useEffect(() => {
    const loadData = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = (await apiClient.me()) as DashboardUser;
        if (currentUser.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`,
          {
            headers: { Authorization: `Bearer ${tokens.accessToken}` }
          }
        );

        if (response.ok) {
          const profile = (await response.json()) as ProProfileData;
          const { lat, lng } = profile;
          if (typeof lat === 'number' && typeof lng === 'number') {
            setOffer((prev: EditableOffer) => ({ ...prev, lat, lng }));
          }
        }

        try {
          const proOfferPayload: unknown = await apiClient.getProOffer();
          const existingOffer = extractProOffer(proOfferPayload);

          if (existingOffer) {
            const normalizedRate =
              typeof existingOffer.hourlyRate === 'string'
                ? Number(existingOffer.hourlyRate)
                : existingOffer.hourlyRate;

            setOffer((prev: EditableOffer) => ({
              ...prev,
              ...existingOffer,
              hourlyRate: Number.isFinite(normalizedRate) ? normalizedRate : prev.hourlyRate,
            }));
          }
        } catch (fetchError) {
          console.log('Aucune offre existante trouvée', fetchError);
        }
      } catch (err: unknown) {
        console.error('Erreur lors du chargement:', err);
        const message = err instanceof Error ? err.message : 'Erreur lors du chargement';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [router]);

  const validateForm = (): boolean => {
    const errors: typeof fieldErrors = {};

    if (!offer.title.trim()) {
      errors.title = 'Le titre est requis';
    } else if (offer.title.length < 10) {
      errors.title = 'Le titre doit faire au moins 10 caractères';
    }

    if (!offer.description.trim()) {
      errors.description = 'La description est requise';
    } else if (offer.description.length < 50) {
      errors.description = 'La description doit faire au moins 50 caractères';
    }

    if (offer.hourlyRate < 10 || offer.hourlyRate > 200) {
      errors.hourlyRate = 'Le tarif doit être entre 10€ et 200€/heure';
    }

    if (!offer.lat || !offer.lng) {
      errors.geolocation = 'La géolocalisation est requise pour publier une offre';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (!validateForm()) {
      return;
    }

    setSaving(true);
    try {
      await apiClient.createOrUpdateProOffer({
        sport: offer.sport,
        level: offer.level,
        title: offer.title,
        description: offer.description,
        hourlyRate: offer.hourlyRate,
        isActive: offer.isActive
      });

      setSuccess('Offre sauvegardée avec succès !');

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const enableGeolocation = () => {
    if (!navigator.geolocation) {
      alert('La géolocalisation n\'est pas supportée par ce navigateur.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        setOffer((prev: EditableOffer) => ({ ...prev, lat, lng }));
        setFieldErrors((prev) => ({ ...prev, geolocation: undefined }));

        // Sauvegarder aussi dans le profil pro
        try {
          const tokens = apiClient.getTokens();
          if (tokens?.accessToken) {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/me`, {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${tokens.accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ lat, lng })
            });
          }
        } catch (error: unknown) {
          console.error('Erreur lors de la sauvegarde de la position:', error);
        }
      },
      (error: GeolocationPositionError) => {
        console.error('Erreur géolocalisation:', error);
        alert('Impossible de récupérer votre position. Vérifiez les autorisations de géolocalisation.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000
      }
    );
  };

  if (loading) return (
    <div className="max-w-2xl mx-auto space-y-4 pt-8">
      <p className="text-center text-muted-foreground">Chargement…</p>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      {/* Header compact avec style océan */}
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 p-4 border-2 border-blue-200/50 dark:border-blue-800/50">
        <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-md">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Mon Offre de Cours 📚</h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            {offer.createdAt && (
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>Publiée le {new Date(offer.createdAt).toLocaleDateString('fr-FR')}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              <span>{offer.stats?.uniqueClicks ?? 0} {(offer.stats?.uniqueClicks ?? 0) > 1 ? 'vues' : 'vue'}</span>
            </div>
          </div>
        </div>
      </div>

      <Card className="border-2 rounded-[1.5rem]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            📊 Visibilité de l'offre
          </CardTitle>
          <CardDescription>
            Nombre de riders ayant cliqué sur ton offre et dernier clic enregistré.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/20">
            <p className="text-sm text-muted-foreground">Riders ayant cliqué</p>
            <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">
              {offer.stats?.uniqueClicks ?? 0}
            </p>
          </div>
          <div className="rounded-xl border p-4 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/20">
            <p className="text-sm text-muted-foreground">Dernier clic</p>
            <p className="text-base font-semibold text-foreground">
              {offer.stats?.lastClickAt
                ? new Date(offer.stats.lastClickAt).toLocaleString('fr-FR')
                : 'Aucun clic pour le moment'}
            </p>
          </div>
        </CardContent>
      </Card>

      {!offer.lat || !offer.lng ? (
        <Card className="border-2 border-amber-200 dark:border-amber-800/50 rounded-[1.75rem] bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
              📍 Géolocalisation requise
            </CardTitle>
            <CardDescription className="text-amber-800 dark:text-amber-200/80">
              Pour créer une offre, tu dois d&apos;abord activer ta géolocalisation.
              Cela permettra aux riders de trouver tes cours près de chez eux.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={enableGeolocation} className="w-full bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700">
              🔄 Activer ma géolocalisation
            </Button>
            {fieldErrors.geolocation && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">{fieldErrors.geolocation}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 px-4 py-3">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">
            ✅ Géolocalisation active ({offer.lat?.toFixed(4)}, {offer.lng?.toFixed(4)})
          </p>
        </div>
      )}

      <Card className="border-2 rounded-[1.75rem]">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <CardTitle className="text-foreground">Détails de l&apos;offre</CardTitle>
          <CardDescription>
            Remplis les informations de ton cours (une seule offre par professionnel pour le MVP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {/* Sport et Niveau */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sport">Sport</Label>
              <select
                id="sport"
                className="h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={offer.sport}
                onChange={(e) =>
                  setOffer((prev: EditableOffer) => ({ ...prev, sport: e.target.value as Sport }))
                }
              >
                {Object.entries(sportLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="level">Niveau ciblé</Label>
              <select
                id="level"
                className="h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={offer.level}
                onChange={(e) =>
                  setOffer((prev: EditableOffer) => ({ ...prev, level: e.target.value as Level }))
                }
              >
                {Object.entries(levelLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Titre */}
          <div className="space-y-2">
            <Label htmlFor="title">Titre de l&apos;offre</Label>
            <Input
              id="title"
              placeholder="Ex: Cours de surf pour débutants à Biarritz"
              value={offer.title}
              onChange={(e) => setOffer((prev: EditableOffer) => ({ ...prev, title: e.target.value }))}
              className={fieldErrors.title ? 'border-red-500' : ''}
            />
            {fieldErrors.title && (
              <p className="text-sm text-red-600">{fieldErrors.title}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              rows={4}
              placeholder="Décrivez votre méthode d&apos;enseignement, le matériel fourni, les spots de cours..."
              className="w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
              value={offer.description}
              onChange={(e) =>
                setOffer((prev: EditableOffer) => ({ ...prev, description: e.target.value }))
              }
            />
            {fieldErrors.description && (
              <p className="text-sm text-red-600">{fieldErrors.description}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {offer.description.length}/200 caractères minimum
            </p>
          </div>

          {/* Tarif */}
          <div className="space-y-2">
            <Label htmlFor="hourlyRate">Tarif (€/heure)</Label>
            <Input
              id="hourlyRate"
              type="number"
              min="10"
              max="200"
              step="5"
              value={offer.hourlyRate}
              onChange={(e) =>
                setOffer((prev: EditableOffer) => ({ ...prev, hourlyRate: Number(e.target.value) }))
              }
              className={fieldErrors.hourlyRate ? 'border-red-500' : ''}
            />
            {fieldErrors.hourlyRate && (
              <p className="text-sm text-red-600">{fieldErrors.hourlyRate}</p>
            )}
          </div>

          {/* Statut */}
          <div className="flex items-center space-x-2">
            <input
              id="isActive"
              type="checkbox"
              checked={offer.isActive}
              onChange={(e) => setOffer((prev: EditableOffer) => ({ ...prev, isActive: e.target.checked }))}
            />
            <Label htmlFor="isActive" className="text-sm">
              Offre active (visible par les riders)
            </Label>
          </div>

          {error && (
            <div className="rounded-2xl border-2 border-red-200 dark:border-red-800/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 p-4">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                ❌ {error}
              </p>
            </div>
          )}

          {success && (
            <div className="rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/50 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 p-4">
              <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">
                ✅ {success}
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Button
              onClick={handleSave}
              disabled={saving || (!offer.lat || !offer.lng)}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              {saving ? 'Sauvegarde...' : 'Sauvegarder l&apos;offre'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/pro/dashboard')} className="sm:w-auto">
              Annuler
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
