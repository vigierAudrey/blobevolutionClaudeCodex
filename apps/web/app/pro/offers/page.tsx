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
import type { Sport, Level } from '@/types/matching';
import type { EditableOffer } from '@/types/offers';
import type { DashboardUser } from '@/types/user';
import type { ProProfileData } from '@/types/pro';

const sportLabels: Record<Sport, string> = {
  surf: 'Surf',
  kitesurf: 'Kitesurf'
};

const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé'
};

type ApiProOffer = Omit<EditableOffer, 'hourlyRate'> & {
  hourlyRate: number | string;
  proProfileId?: string;
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
            setOffer(prev => ({ ...prev, lat, lng }));
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

            setOffer(prev => ({
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

        setOffer(prev => ({ ...prev, lat, lng }));
        setFieldErrors(prev => ({ ...prev, geolocation: undefined }));

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

  if (loading) return <p>Chargement…</p>;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackBar fallbackHref="/pro/dashboard" />

      <div>
        <h1 className="text-2xl font-semibold">Mon Offre de Cours</h1>
        <p className="text-sm text-muted-foreground">
          Créez votre offre de cours pour attirer des élèves près de chez vous.
        </p>
      </div>

      {!offer.lat || !offer.lng ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📍 Géolocalisation requise
            </CardTitle>
            <CardDescription>
              Pour créer une offre, vous devez d&apos;abord activer votre géolocalisation.
              Cela permettra aux riders de trouver vos cours près de chez eux.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={enableGeolocation} className="w-full">
              🔄 Activer ma géolocalisation
            </Button>
            {fieldErrors.geolocation && (
              <p className="text-sm text-red-600 mt-2">{fieldErrors.geolocation}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="text-sm text-green-600 mb-4">
          ✅ Géolocalisation active ({offer.lat?.toFixed(4)}, {offer.lng?.toFixed(4)})
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Détails de l&apos;offre</CardTitle>
          <CardDescription>
            Remplissez les informations de votre cours (une seule offre par professionnel pour le MVP).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sport et Niveau */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sport">Sport</Label>
              <select
                id="sport"
                className="h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={offer.sport}
                onChange={(e) => setOffer(prev => ({ ...prev, sport: e.target.value as Sport }))}
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
                onChange={(e) => setOffer(prev => ({ ...prev, level: e.target.value as Level }))}
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
              onChange={(e) => setOffer(prev => ({ ...prev, title: e.target.value }))}
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
              onChange={(e) => setOffer(prev => ({ ...prev, description: e.target.value }))}
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
              onChange={(e) => setOffer(prev => ({ ...prev, hourlyRate: Number(e.target.value) }))}
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
              onChange={(e) => setOffer(prev => ({ ...prev, isActive: e.target.checked }))}
            />
            <Label htmlFor="isActive" className="text-sm">
              Offre active (visible par les riders)
            </Label>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
              {success}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button
              onClick={handleSave}
              disabled={saving || (!offer.lat || !offer.lng)}
              className="flex-1"
            >
              {saving ? 'Sauvegarde...' : 'Sauvegarder l&apos;offre'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/pro/dashboard')}>
              Annuler
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
