"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiClient } from '../../lib/apiClient';
import { MapPin, Euro, Star, ChevronRight } from 'lucide-react';
import type { Sport, Level } from '@/types/matching';
import type { OfferCard, OfferFilters, OfferSearchResponse } from '@/types/offers';

type OfferSortKey = 'distance' | 'price' | 'sport' | 'recent';

const sportLabels: Record<Sport, string> = {
  surf: 'Surf',
  kitesurf: 'Kitesurf'
};

const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé'
};

export default function OffersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGeolocation, setHasGeolocation] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [filters, setFilters] = useState<OfferFilters>({ sport: '', level: '', radiusKm: 50 });
  const [sortBy, setSortBy] = useState<OfferSortKey>('distance');
  const [allOffers, setAllOffers] = useState<OfferCard[]>([]);
  const [filteredOffers, setFilteredOffers] = useState<OfferCard[]>([]);

  const applyFiltersAndSort = useCallback(
    (offersToFilter: OfferCard[] = allOffers) => {
      let filtered = [...offersToFilter];

      if (filters.sport) {
        filtered = filtered.filter((offer) => offer.sport === filters.sport);
      }

      if (filters.level) {
        filtered = filtered.filter((offer) => offer.level === filters.level);
      }

      filtered.sort((a, b) => {
        switch (sortBy) {
          case 'distance':
            return a.distanceKm - b.distanceKm;
          case 'price':
            return a.hourlyRate - b.hourlyRate;
          case 'sport':
            return a.sport.localeCompare(b.sport) || a.distanceKm - b.distanceKm;
          case 'recent':
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          default:
            return 0;
        }
      });

      setFilteredOffers(filtered);
    },
    [allOffers, filters.level, filters.sport, sortBy],
  );

  const searchOffers = useCallback(
    async (lat: number, lng: number) => {
      setSearching(true);
      setError(null);

      try {
        const response = (await apiClient.searchOffers({
          lat,
          lng,
          radiusKm: filters.radiusKm,
        })) as OfferSearchResponse;

        const fetchedOffers = response.offers ?? [];
        setAllOffers(fetchedOffers);
        applyFiltersAndSort(fetchedOffers);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : null;
        setError(message || 'Erreur lors de la recherche');
      } finally {
        setSearching(false);
      }
    },
    [applyFiltersAndSort, filters.radiusKm],
  );

  useEffect(() => {
    const loadUserAndSearch = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = await apiClient.me();
        if (currentUser.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }

        const profile = await apiClient.getProfile();
        if (profile.lat != null && profile.lng != null) {
          const position = { lat: profile.lat, lng: profile.lng };
          setUserLocation(position);
          setHasGeolocation(true);
          await searchOffers(position.lat, position.lng);
        } else {
          setHasGeolocation(false);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : null;
        setError(message || 'Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    };

    void loadUserAndSearch();
  }, [router, searchOffers]);

  useEffect(() => {
    applyFiltersAndSort();
  }, [applyFiltersAndSort]);

  const enableGeolocation = () => {
    if (!navigator.geolocation) {
      alert('La géolocalisation n’est pas supportée par ce navigateur.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setUserLocation({ lat, lng });
        setHasGeolocation(true);

        try {
          await apiClient.updateProfile({ lat, lng });
        } catch (error) {
          console.error('Erreur lors de la sauvegarde de la position :', error);
        }

        await searchOffers(lat, lng);
      },
      (error) => {
        console.error('Erreur géolocalisation :', error);
        alert('Impossible de récupérer votre position. Vérifiez les autorisations de géolocalisation.');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      },
    );
  };

  const handleRadiusChange = async () => {
    if (userLocation) {
      await searchOffers(userLocation.lat, userLocation.lng);
    }
  };

  const contactPro = async (proUserId: string) => {
    try {
      const conversation = await apiClient.openConversation(proUserId);
      router.push(`/messages/${conversation.id}`);
    } catch (error) {
      console.error('Erreur lors de l’ouverture de la conversation :', error);
      alert('Erreur lors de l’ouverture de la conversation');
    }
  };

  if (loading) return <p>Chargement…</p>;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <BackBar fallbackHref="/dashboard" />

      <div>
        <h1 className="text-2xl font-semibold">Offres de Cours</h1>
        <p className="text-sm text-muted-foreground">
          Découvre les cours proposés par des professionnels près de chez toi.
        </p>
      </div>

      {!hasGeolocation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📍 Géolocalisation requise
            </CardTitle>
            <CardDescription>
              Pour voir les offres près de chez vous, activez votre géolocalisation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={enableGeolocation} className="w-full">
              🔄 Activer ma géolocalisation
            </Button>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              ℹ️ Votre position sera sauvegardée dans votre profil et utilisée uniquement
              pour trouver des offres à proximité. Vous pouvez la modifier ou la supprimer
              à tout moment dans vos paramètres.
            </p>
          </CardContent>
        </Card>
      )}

      {hasGeolocation && (
        <>
          {/* Filtres et tri */}
          <Card>
            <CardHeader>
              <CardTitle>Filtres et tri</CardTitle>
              <CardDescription>
                Filtrez et triez les offres pour trouver ce qui vous convient le mieux.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sport">Sport</Label>
                  <select
                    id="sport"
                    className="h-10 w-full rounded-md border px-3 py-2 text-sm"
                    value={filters.sport}
                    onChange={(e) => setFilters(prev => ({ ...prev, sport: e.target.value as Sport | '' }))}
                  >
                    <option value="">Tous les sports</option>
                    {Object.entries(sportLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="level">Niveau</Label>
                  <select
                    id="level"
                    className="h-10 w-full rounded-md border px-3 py-2 text-sm"
                    value={filters.level}
                    onChange={(e) => setFilters(prev => ({ ...prev, level: e.target.value as Level | '' }))}
                  >
                    <option value="">Tous les niveaux</option>
                    {Object.entries(levelLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="radius">Rayon (km)</Label>
                  <Input
                    id="radius"
                    type="number"
                    min="5"
                    max="200"
                    step="5"
                    value={filters.radiusKm}
                    onChange={(e) => setFilters(prev => ({ ...prev, radiusKm: Number(e.target.value) }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sort">Trier par</Label>
                  <select
                    id="sort"
                    className="h-10 w-full rounded-md border px-3 py-2 text-sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'distance' | 'price' | 'sport' | 'recent')}
                  >
                    <option value="distance">🗺️ Distance (proche d&apos;abord)</option>
                    <option value="price">💰 Prix (moins cher d&apos;abord)</option>
                    <option value="sport">🏄 Sport (A-Z)</option>
                    <option value="recent">🆕 Récent (nouveau d&apos;abord)</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  onClick={handleRadiusChange}
                  disabled={searching}
                  variant="outline"
                  className="flex-1 sm:flex-none"
                >
                  {searching ? 'Mise à jour...' : 'Mettre à jour le rayon'}
                </Button>

                <Button
                  onClick={() => {
                    setFilters({ sport: '', level: '', radiusKm: 50 });
                    setSortBy('distance');
                  }}
                  variant="outline"
                  className="flex-1 sm:flex-none"
                >
                  Réinitialiser
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Résultats */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">
                {filteredOffers.length} offre(s) affichée(s)
                {allOffers.length !== filteredOffers.length && ` sur ${allOffers.length} trouvée(s)`}
                {userLocation && ` dans un rayon de ${filters.radiusKm}km`}
              </h2>

              {/* Indicateur de tri actuel */}
              <div className="text-sm text-muted-foreground">
                Triées par {
                  sortBy === 'distance' ? 'distance' :
                  sortBy === 'price' ? 'prix' :
                  sortBy === 'sport' ? 'sport' : 'date'
                }
              </div>
            </div>

            {filteredOffers.length === 0 && !searching && hasGeolocation && (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground">
                    {allOffers.length === 0
                      ? 'Aucune offre trouvée dans ce rayon.'
                      : 'Aucune offre ne correspond à ces filtres.'
                    }
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {allOffers.length === 0
                      ? 'Essayez d\'augmenter le rayon de recherche.'
                      : 'Modifiez les filtres ou cliquez sur "Réinitialiser".'
                    }
                  </p>
                </CardContent>
              </Card>
            )}

            {filteredOffers.map((offer) => (
              <Card key={offer.id} className="hover:shadow-md transition-shadow overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row items-start gap-4">
                    <div className="flex items-start gap-3 w-full sm:w-auto">
                      <div className="relative flex-shrink-0">
                        {offer.pro.photoUrl ? (
                          <Image
                            src={offer.pro.photoUrl}
                            alt={offer.pro.businessName ?? 'Photo du professionnel'}
                            width={48}
                            height={48}
                            className="h-12 w-12 rounded-full object-cover border-2 border-gray-200"
                            unoptimized
                          />
                        ) : (
                          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-semibold text-sm">
                            {(offer.pro.businessName ?? offer.title).charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 w-full">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          {sportLabels[offer.sport]}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                          {levelLabels[offer.level]}
                        </span>
                        {offer.pro.verified && (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                            <Star size={12} fill="currentColor" />
                            Vérifié
                          </span>
                        )}
                      </div>

                      <h3 className="text-lg font-semibold mb-2 break-words">{offer.title}</h3>

                      <p className="text-muted-foreground text-sm mb-3 overflow-hidden break-words hyphens-auto"
                         style={{
                           display: '-webkit-box',
                           WebkitLineClamp: 2,
                           WebkitBoxOrient: 'vertical',
                           lineHeight: '1.4',
                           maxHeight: '2.8em'
                         }}>
                        {offer.description}
                      </p>

                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-3">
                        <div className="flex items-center gap-1">
                          <MapPin size={14} />
                          <span>À {offer.distanceKm} km</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Euro size={14} />
                          <span>{offer.hourlyRate}€/heure</span>
                        </div>
                        {offer.pro.businessName && (
                          <div className="flex items-center gap-1">
                            <span className="break-words">par {offer.pro.businessName}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 w-full sm:w-auto">
                      <Button
                        onClick={() => contactPro(offer.pro.userId)}
                        className="inline-flex items-center justify-center gap-1 w-full sm:w-auto"
                      >
                        Contacter
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
