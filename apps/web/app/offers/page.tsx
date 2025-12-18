"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiClient } from '../../lib/apiClient';
import { MapPin, Euro, Star, ChevronRight, Sparkles, Filter as FilterIcon, Search, GraduationCap } from 'lucide-react';
import type { Sport, Level } from '@/types/matching';
import type { OfferCard, OfferFilters, OfferSearchResponse } from '@/types/offers';
import { Badge } from '../../components/ui/badge';
import { Spinner } from '../../components/ui/spinner';

type OfferSortKey = 'distance' | 'price' | 'sport' | 'recent';

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

type GeoStatus = 'loading' | 'ready' | 'missing';

export default function OffersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('loading');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [filters, setFilters] = useState<OfferFilters>({ sport: '', level: '', radiusKm: 50 });
  const [sortBy, setSortBy] = useState<OfferSortKey>('distance');
  const [allOffers, setAllOffers] = useState<OfferCard[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<OfferFilters | null>(null);
  const [totalResults, setTotalResults] = useState(0);
  const [myBookingsCount, setMyBookingsCount] = useState(0);
  const filtersRef = useRef(filters);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const filteredOffers = useMemo(() => {
    const sorted = [...allOffers];

    sorted.sort((a, b) => {
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

    return sorted;
  }, [allOffers, sortBy]);

  const searchOffers = useCallback(
    async (lat: number, lng: number, overrideFilters?: OfferFilters) => {
      setSearching(true);
      setError(null);

      const baseFilters = overrideFilters ?? filtersRef.current;
      const activeFilters: OfferFilters = baseFilters ? { ...baseFilters } : { sport: '', level: '', radiusKm: 50 };

      try {
        const response = (await apiClient.searchOffers({
          lat,
          lng,
          radiusKm: activeFilters.radiusKm,
          sport: activeFilters.sport || undefined,
          level: activeFilters.level || undefined,
        })) as OfferSearchResponse;

        const fetchedOffers = response.offers ?? [];
        setAllOffers(fetchedOffers);
        setTotalResults(response.total ?? fetchedOffers.length);
        setAppliedFilters(activeFilters);
        filtersRef.current = activeFilters;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : null;
        setError(message || 'Erreur lors de la recherche');
      } finally {
        setSearching(false);
      }
    },
    [],
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
          setGeoStatus('ready');
          await searchOffers(position.lat, position.lng);
        } else {
          setGeoStatus('missing');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : null;
        setError(message || 'Erreur lors du chargement');
        setGeoStatus('missing');
      } finally {
        setLoading(false);
      }
    };

    void loadUserAndSearch();
  }, [router, searchOffers]);

  // Charger le nombre de cours réservés
  useEffect(() => {
    const loadBookingsCount = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (tokens?.accessToken) {
          const response = await apiClient.getRiderBookings();
          setMyBookingsCount(response.bookings.length);
        }
      } catch (err) {
        // Silently fail, not critical
        console.warn('Failed to load bookings count:', err);
      }
    };
    void loadBookingsCount();
  }, []);

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
        setGeoStatus('ready');

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

  const handleApplyFilters = async () => {
    if (userLocation) {
      await searchOffers(userLocation.lat, userLocation.lng);
    }
  };

  const handleResetFilters = async () => {
    const defaultFilters: OfferFilters = { sport: '', level: '', radiusKm: 50 };
    setFilters(defaultFilters);
    filtersRef.current = defaultFilters;
    setSortBy('distance');

    if (userLocation) {
      await searchOffers(userLocation.lat, userLocation.lng, defaultFilters);
    } else {
      setAppliedFilters(defaultFilters);
      setAllOffers([]);
      setTotalResults(0);
    }
  };

  const contactPro = async (offer: OfferCard) => {
    try {
      // Comptabiliser le clic avant d'ouvrir la conversation (optimisé via upsert côté API)
      await apiClient.trackOfferClick(offer.id);
    } catch (error) {
      console.warn('Impossible d’enregistrer le clic sur l’offre', error);
    }

    try {
      const conversation = await apiClient.openConversation(offer.pro.userId);
      router.push(`/messages/${conversation.id}`);
    } catch (error) {
      console.error('Erreur lors de l’ouverture de la conversation :', error);
      alert('Erreur lors de l’ouverture de la conversation');
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <BackBar fallbackHref="/dashboard" />
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      <BackBar fallbackHref="/dashboard" />

      {/* Bouton Mes Cours Réservés */}
      {myBookingsCount > 0 && (
        <div className="rounded-2xl bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20 p-4 border-2 border-purple-200/50 dark:border-purple-800/50">
          <Button
            onClick={() => router.push('/my-lessons')}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white h-auto py-4"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <GraduationCap className="w-5 h-5" />
                <div className="text-left">
                  <div className="font-semibold">Mes Cours Réservés</div>
                  <div className="text-xs opacity-90">Tu as {myBookingsCount} {myBookingsCount > 1 ? 'cours confirmés' : 'cours confirmé'}</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5" />
            </div>
          </Button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center gap-3 pb-2 border-b">
        <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
          <Search className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Trouve un moniteur</h1>
            <Badge variant="secondary" className="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
              <Sparkles className="w-3 h-3 mr-1" />
              Pros autour de toi
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">Géolocalise-toi, filtre et ouvre la conversation directement</p>
        </div>
      </div>

      {geoStatus === 'loading' && (
        <Card className="animate-pulse border-2">
          <CardHeader>
            <div className="h-5 w-32 rounded-md bg-muted" />
            <div className="h-4 w-56 rounded-md bg-muted/80" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-10 w-full rounded-md bg-muted" />
            <div className="h-3 w-40 rounded-md bg-muted/80" />
          </CardContent>
        </Card>
      )}

      {geoStatus === 'missing' && (
        <Card className="border-2 shadow-sm">
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

      {geoStatus === 'ready' && (
        <>
          {/* Filtres et tri */}
          <Card className="border-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-white text-slate-700">
                  Filtres
                </Badge>
                <CardTitle className="flex items-center gap-2">
                  <FilterIcon className="w-4 h-4 text-muted-foreground" />
                  Filtres et tri
                </CardTitle>
              </div>
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
                    className="h-10 w-full rounded-xl border px-3 py-2 text-sm"
                    value={filters.sport}
                    onChange={(e) =>
                      setFilters((prev: OfferFilters) => ({ ...prev, sport: e.target.value as Sport | '' }))
                    }
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
                    className="h-10 w-full rounded-xl border px-3 py-2 text-sm"
                    value={filters.level}
                    onChange={(e) =>
                      setFilters((prev: OfferFilters) => ({ ...prev, level: e.target.value as Level | '' }))
                    }
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
                    onChange={(e) =>
                      setFilters((prev: OfferFilters) => ({ ...prev, radiusKm: Number(e.target.value) }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sort">Trier par</Label>
                  <select
                    id="sort"
                    className="h-10 w-full rounded-xl border px-3 py-2 text-sm"
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

              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={handleApplyFilters}
                  disabled={searching || !userLocation}
                  className="flex-1 sm:flex-none"
                >
                  {searching ? 'Recherche en cours…' : 'Appliquer mes filtres'}
                </Button>

                <Button
                  onClick={handleResetFilters}
                  variant="outline"
                  disabled={searching}
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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {filteredOffers.length} offre(s) affichée(s)
                  {totalResults > 0 && totalResults !== filteredOffers.length && ` sur ${totalResults} trouvée(s)`}
                  {appliedFilters && ` · ${appliedFilters.radiusKm} km`}
                </h2>
                {appliedFilters && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Filtres : {appliedFilters.sport ? sportLabels[appliedFilters.sport] : 'tous les sports'} · {appliedFilters.level ? levelLabels[appliedFilters.level] : 'tous les niveaux'}
                  </p>
                )}
              </div>

              <div className="text-sm text-muted-foreground">
                Triées par {
                  sortBy === 'distance' ? 'distance' :
                  sortBy === 'price' ? 'prix' :
                  sortBy === 'sport' ? 'sport' : 'date'
                }
              </div>
            </div>

            {searching && (
              <Card className="border-dashed">
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  Recherche des offres à proximité…
                </CardContent>
              </Card>
            )}

            {filteredOffers.length === 0 && !searching && geoStatus === 'ready' && (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground">
                    {filteredOffers.length === 0
                      ? 'Aucune offre trouvée dans ce rayon.'
                      : 'Aucune offre ne correspond à ces filtres.'
                    }
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {filteredOffers.length === 0
                      ? 'Ajustez le rayon ou changez de sport/niveau, puis cliquez sur "Appliquer mes filtres".'
                      : 'Modifiez les filtres puis validez avec "Appliquer mes filtres".'
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
                        onClick={() => contactPro(offer)}
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
