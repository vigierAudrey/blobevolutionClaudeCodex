"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Briefcase, MessageSquare, MapPin, Euro, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { apiClient } from '../../../lib/apiClient';

type ProProfile = {
  id: string;
  userId: string;
  businessName: string;
  bio: string;
  lat: number | null;
  lng: number | null;
  offer?: {
    sport: string;
    level: string;
    title: string;
    description: string;
    hourlyRate: number;
    isActive: boolean;
  };
};

export default function ProNetworkPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [pros, setPros] = useState<ProProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Vérification auth et rôle PRO
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = await apiClient.me();
        if (currentUser.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }

        setUser(currentUser);
        await loadPros();
      } catch (err) {
        console.error('Auth check failed:', err);
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  const loadPros = async () => {
    try {
      // Pour le moment, on utilise l'API des offres pour récupérer les pros
      // Dans une vraie app, il faudrait une API dédiée pour lister les pros
      const response = await apiClient.searchOffers({});

      // Créer une liste unique de pros depuis leurs offres
      const uniquePros = new Map<string, ProProfile>();

      response.offers?.forEach((offer: any) => {
        if (!uniquePros.has(offer.proProfile.userId)) {
          uniquePros.set(offer.proProfile.userId, {
            id: offer.proProfile.id,
            userId: offer.proProfile.userId,
            businessName: offer.proProfile.businessName || 'Professionnel',
            bio: offer.proProfile.bio || '',
            lat: offer.lat,
            lng: offer.lng,
            offer: {
              sport: offer.sport,
              level: offer.level,
              title: offer.title,
              description: offer.description,
              hourlyRate: offer.hourlyRate,
              isActive: offer.isActive
            }
          });
        }
      });

      setPros(Array.from(uniquePros.values()));
    } catch (err: any) {
      setError('Erreur lors du chargement des professionnels');
      console.error('Error loading pros:', err);
    }
  };

  const handleContactPro = async (proUserId: string) => {
    try {
      const conversation = await apiClient.openConversation(proUserId);
      router.push(`/messages/${conversation.id}`);
    } catch (err: any) {
      console.error('Error opening conversation:', err);
      alert('Erreur lors de l\'ouverture de la conversation');
    }
  };

  const filteredPros = pros.filter(pro => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      pro.businessName?.toLowerCase().includes(query) ||
      pro.bio?.toLowerCase().includes(query) ||
      pro.offer?.sport?.toLowerCase().includes(query) ||
      pro.offer?.title?.toLowerCase().includes(query)
    );
  }).filter(pro => pro.userId !== user?.id); // Exclure soi-même

  if (loading) return <p>Chargement…</p>;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header avec retour */}
      <div className="flex items-center gap-4">
        <Link href="/pro/dashboard">
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            <ArrowLeft size={16} />
            Dashboard
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Réseau Professionnel</h1>
          <p className="text-sm text-muted-foreground">
            Découvrez et contactez d'autres professionnels
          </p>
        </div>
      </div>

      {/* Recherche */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Search size={20} className="text-muted-foreground" />
            <Input
              placeholder="Rechercher par nom, sport, description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {/* Liste des pros */}
      <div className="space-y-4">
        {filteredPros.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-muted-foreground">
              <Briefcase size={48} className="mx-auto mb-4 opacity-50" />
              {searchQuery ? (
                <p>Aucun professionnel trouvé pour "{searchQuery}"</p>
              ) : (
                <div>
                  <p>Aucun autre professionnel trouvé pour le moment.</p>
                  <p className="text-sm mt-2">
                    Les professionnels apparaîtront ici quand ils créeront leurs offres.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredPros.map((pro) => (
            <Card key={pro.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <Briefcase size={18} className="text-green-600" />
                      {pro.businessName}
                    </CardTitle>
                    {pro.bio && (
                      <p className="text-sm text-muted-foreground mt-2">{pro.bio}</p>
                    )}
                  </div>
                  <Button
                    onClick={() => handleContactPro(pro.userId)}
                    className="flex items-center gap-2"
                    size="sm"
                  >
                    <MessageSquare size={16} />
                    Contacter
                  </Button>
                </div>
              </CardHeader>

              {pro.offer && (
                <CardContent>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{pro.offer.title}</h4>
                      <div className="flex items-center gap-1 text-green-600 font-medium">
                        <Euro size={14} />
                        {pro.offer.hourlyRate}€/h
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-2">
                      <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">
                        {pro.offer.sport}
                      </span>
                      <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs">
                        {pro.offer.level}
                      </span>
                      {pro.offer.isActive && (
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded text-xs">
                          Actif
                        </span>
                      )}
                    </div>

                    {pro.offer.description && (
                      <p className="text-sm text-gray-600">{pro.offer.description}</p>
                    )}

                    {pro.lat && pro.lng && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                        <MapPin size={12} />
                        Localisé
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}