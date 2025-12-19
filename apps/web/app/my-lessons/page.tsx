"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { GraduationCap, MessageSquare, MapPin, Calendar } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { BackBar } from '../../components/BackBar';
import type { DashboardUser } from '@/types/user';
import type { Level } from '@/types/matching';

const levelLabels: Record<Level, string> = {
  beginner: 'Débutant',
  intermediate: 'Intermédiaire',
  advanced: 'Confirmé',
  anytime: 'Peu importe'
};

export default function MyLessonsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.getRiderBookings();
      setBookings(response.bookings);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur de chargement des cours';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    apiClient
      .me()
      .then((u: DashboardUser) => {
        if (u.role === 'PRO') {
          router.replace('/pro/dashboard');
          return;
        }
        void loadBookings();
      })
      .catch(() => router.replace('/login'));
  }, [loadBookings, router]);

  if (loading) {
    return <p className="max-w-5xl mx-auto py-6 text-sm text-muted-foreground">Chargement de tes cours…</p>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-8 px-4 sm:px-6 lg:px-0">
      <BackBar fallbackHref="/dashboard" />

      {/* Header avec style Peps */}
      <div className="rounded-2xl bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20 p-6 border-2 border-purple-200/50 dark:border-purple-800/50">
        <div className="flex items-center gap-4">
          <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Mes Cours Réservés 🏄‍♀️</h1>
            <p className="text-sm text-muted-foreground">
              {bookings.length} {bookings.length > 1 ? 'cours confirmés' : 'cours confirmé'}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border-2 border-red-200 dark:border-red-800/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-300 font-medium">❌ {error}</p>
        </div>
      )}

      {/* Message informatif permanent */}
      <div className="rounded-2xl bg-blue-50/80 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">💬</span>
          <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
            <p className="font-semibold">Prochaine étape :</p>
            <p>Contacte ton instructeur via la messagerie pour confirmer le lieu de rendez-vous exact.</p>
          </div>
        </div>
      </div>

      {/* Rappel sécurité carte professionnelle */}
      <div className="rounded-2xl bg-amber-50/80 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
            <p className="font-semibold">Important - MVP :</p>
            <p>L'application est encore en phase de test (MVP). Pense à vérifier par toi-même la carte professionnelle de ton instructeur avant le cours.</p>
          </div>
        </div>
      </div>

      {bookings.length === 0 ? (
        <Card className="border-2 rounded-[2rem]">
          <CardContent className="py-10 text-center space-y-4">
            <div className="text-6xl">🏄</div>
            <div className="space-y-2">
              <h3 className="font-semibold text-xl text-foreground">Aucun cours réservé</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Explore les créneaux disponibles et réserve ton premier cours pour progresser avec un pro !
              </p>
            </div>
            <Button onClick={() => router.push('/booking/search')} className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
              Trouver un pro
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <Card key={booking.id} className="border-2 rounded-[2rem] hover:shadow-lg transition-shadow">
              <CardHeader className="flex flex-row items-start justify-between bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {booking.availability?.pro?.proProfile?.photoUrl ? (
                      <img
                        src={booking.availability.pro.proProfile.photoUrl}
                        alt={booking.availability.pro.proProfile.businessName || 'Instructeur'}
                        className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-xl border-2 border-white shadow-sm">
                        👨‍🏫
                      </div>
                    )}
                    <div>
                      <CardTitle className="text-foreground">
                        {booking.availability?.pro?.proProfile?.businessName || 'Instructeur'}
                      </CardTitle>
                      <CardDescription className="text-sm">
                        {booking.availability?.sport === 'surf' ? '🏄 Surf' : '🪁 Kitesurf'}
                      </CardDescription>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 border-green-300 dark:border-green-700">
                    ✓ Confirmé
                  </Badge>
                  {booking.availability && booking.availability.bookedCount >= booking.availability.capacity && (
                    <Badge variant="destructive">Complet</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {booking.availability && (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-2 text-muted-foreground">
                      <Calendar className="w-4 h-4 mt-0.5 text-purple-600 dark:text-purple-400" />
                      <div>
                        <p className="font-medium text-foreground">
                          {new Date(booking.availability.startAt).toLocaleDateString('fr-FR', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </p>
                        <p className="text-xs">
                          {new Date(booking.availability.startAt).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })} → {new Date(booking.availability.endAt).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>

                    {booking.availability.spotName && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin className="w-4 h-4 mt-0.5 text-purple-600 dark:text-purple-400" />
                        <div>
                          <p className="font-medium text-foreground">{booking.availability.spotName}</p>
                          {booking.availability.spotLat && booking.availability.spotLng && (
                            <a
                              href={`https://www.google.com/maps?q=${booking.availability.spotLat},${booking.availability.spotLng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs underline hover:text-foreground"
                            >
                              Voir sur Google Maps
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl bg-muted/50 p-3 text-xs space-y-1">
                      <p>
                        <strong>Niveaux :</strong> {booking.availability.levels.map((level: string) => levelLabels[level as Level] || level).join(', ')}
                      </p>
                      <p>
                        <strong>Capacité :</strong> {booking.availability.bookedCount}/{booking.availability.capacity} inscrits
                      </p>
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => router.push('/messages')}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Contacter l'instructeur
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
