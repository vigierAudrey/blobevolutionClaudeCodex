"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../components/BackBar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiClient } from '../../lib/apiClient';
import { MapPin, Clock, Euro, Star, ChevronRight } from 'lucide-react';

type Sport = 'surf' | 'kitesurf';
type Level = 'beginner' | 'intermediate' | 'advanced';

type ProOffer = {
  id: string;
  sport: Sport;
  level: Level;
  title: string;
  description: string;
  hourlyRate: number;
  lat: number;
  lng: number;
  createdAt: string;
  distanceKm: number;
  pro: {
    id: string;
    userId: string;
    businessName?: string;
    bio?: string;
    photoUrl?: string;
    verified: boolean;
  };
};

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
  const [user, setUser] = useState<any>(null);
  const [offers, setOffers] = useState<ProOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGeolocation, setHasGeolocation] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | null>(null);

  // Filtres et tri
  const [filters, setFilters] = useState({
    sport: '' as Sport | '',
    level: '' as Level | '',
    radiusKm: 50
  });

  const [sortBy, setSortBy] = useState<'distance' | 'price' | 'sport' | 'recent'>('distance');
  const [allOffers, setAllOffers] = useState<ProOffer[]>([]);
  const [filteredOffers, setFilteredOffers] = useState<ProOffer[]>([]);

  useEffect(() => {
    const loadUserAndSearch = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = await apiClient.me();
        setUser(currentUser);

        // Rediriger les PRO vers leur dashboard
        if (currentUser.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }

        // Récupérer la géolocalisation depuis le profil
        const profile = await apiClient.getProfile();
        if (profile.lat && profile.lng) {
          setUserLocation({ lat: profile.lat, lng: profile.lng });
          setHasGeolocation(true);
          await searchOffers(profile.lat, profile.lng);
        } else {
          setHasGeolocation(false);
        }

      } catch (err: any) {
        console.error('Erreur lors du chargement:', err);
        setError(err?.message || 'Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    };

    loadUserAndSearch();
  }, [router]);

  const searchOffers = async (lat?: number, lng?: number) => {
    if (!lat || !lng) return;

    setSearching(true);
    setError(null);

    try {
      // Récupérer TOUTES les offres dans le rayon, sans filtres côté serveur
      const params = new URLSearchParams({
        lat: lat.toString(),
        lng: lng.toString(),
        radiusKm: filters.radiusKm.toString()
      });

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/pro/offers/search?${params}`,
        {
          headers: {
            Authorization: `Bearer ${apiClient.getTokens()?.accessToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Erreur lors de la recherche des offres');
      }

      const data = await response.json();
      const fetchedOffers = data.offers || [];

      setAllOffers(fetchedOffers);
      applyFiltersAndSort(fetchedOffers);

    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la recherche');
    } finally {
      setSearching(false);
    }
  };

  // Fonction pour appliquer filtres et tri côté client
  const applyFiltersAndSort = (offersToFilter: ProOffer[] = allOffers) => {
    let filtered = [...offersToFilter];

    // Appliquer les filtres
    if (filters.sport) {
      filtered = filtered.filter(offer => offer.sport === filters.sport);
    }

    if (filters.level) {
      filtered = filtered.filter(offer => offer.level === filters.level);
    }

    // Appliquer le tri
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
          return a.distanceKm - b.distanceKm;
      }
    });

    setFilteredOffers(filtered);
    setOffers(filtered); // Pour compatibilité avec le reste du code
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
        setUserLocation({ lat, lng });
        setHasGeolocation(true);

        // Sauvegarder dans le profil
        try {
          await apiClient.updateProfile({ lat, lng });
        } catch (error) {
          console.error('Erreur lors de la sauvegarde de la position:', error);
        }

        await searchOffers(lat, lng);
      },
      (error) => {
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

  // Effect pour re-appliquer filtres et tri quand ils changent
  useEffect(() => {
    applyFiltersAndSort();
  }, [filters.sport, filters.level, sortBy]);

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
      console.error('Erreur lors de l\'ouverture de la conversation:', error);
      alert('Erreur lors de l\'ouverture de la conversation');
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
          <CardContent>
            <Button onClick={enableGeolocation} className="w-full">
              🔄 Activer ma géolocalisation
            </Button>
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
                    <option value="distance">🗺️ Distance (proche d'abord)</option>
                    <option value="price">💰 Prix (moins cher d'abord)</option>
                    <option value="sport">🏄 Sport (A-Z)</option>
                    <option value="recent">🆕 Récent (nouveau d'abord)</option>
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

            {offers.map((offer) => (
              <Card key={offer.id} className="hover:shadow-md transition-shadow overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row items-start gap-4">
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