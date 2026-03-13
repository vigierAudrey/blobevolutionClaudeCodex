"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import dynamicImport from 'next/dynamic';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { Slider } from '../../../components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../../components/ui/dialog';
import { StatusMessage } from '../../../components/ui/status-message';
import { ReservationStepper } from '../../../components/reservations/ReservationStepper';
import { RiderMiniaturesStrip } from '../../../components/reservations/RiderMiniaturesStrip';
import { apiClient, type BookingAvailabilityResult, type NearbyProResult } from '../../../lib/apiClient';
import { ContactProModal } from './ContactProModal';
import { Waves, Wind, Calendar, MapPin, Sparkles, TrendingUp, Users, Target } from 'lucide-react';

const AvailabilityMap = dynamicImport(() => import('../../../components/MapComponent'), { ssr: false });

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
};

const levels: Array<{ id: 'beginner' | 'intermediate' | 'advanced'; label: string }> = [
  { id: 'beginner', label: 'Débutant' },
  { id: 'intermediate', label: 'Intermédiaire' },
  { id: 'advanced', label: 'Confirmé' },
];

export default function ReservationStartPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedSport, setSelectedSport] = useState<'surf' | 'kitesurf' | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<'beginner' | 'intermediate' | 'advanced' | null>(null);
  const [distanceKm, setDistanceKm] = useState(25);
  const [results, setResults] = useState<BookingAvailabilityResult[]>([]);
  const [nearbyPros, setNearbyPros] = useState<NearbyProResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [loadingPros, setLoadingPros] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prosError, setProsError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>({ lat: 43.493, lng: -1.558 });
  const [manualLat, setManualLat] = useState('43.493');
  const [manualLng, setManualLng] = useState('-1.558');
  const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'success' | 'denied' | 'error'>('idle');
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [requestingSlot, setRequestingSlot] = useState<BookingAvailabilityResult | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<{ spotName: string | null; startAt: string } | null>(null);
  const [contactPro, setContactPro] = useState<NearbyProResult | null>(null);
  const [contactSuccess, setContactSuccess] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

  const steps = useMemo(() => ['Préférences', 'Zone', 'Résultats'], []);
  const safeResults = useMemo(() => (Array.isArray(results) ? results : []), [results]);

  const canGoNextFromStep1 = selectedSport !== null && selectedLevel !== null;

  useEffect(() => {
    if (step !== 3 || !selectedSport || !selectedLevel || !location) {
      return;
    }

    let cancelled = false;
    const loadResults = async () => {
      setLoadingResults(true);
      setLoadingPros(true);
      setError(null);
      setProsError(null);

      const [availabilityResult, prosResult] = await Promise.allSettled([
        apiClient.searchBookingAvailability({
          sport: selectedSport,
          level: selectedLevel,
          lat: location.lat,
          lng: location.lng,
          radiusKm: distanceKm,
          page: 1,
          pageSize: 20,
        }),
        apiClient.searchNearbyPros({
          lat: location.lat,
          lng: location.lng,
          radiusKm: distanceKm,
          sport: selectedSport ?? undefined,
        }),
      ]);

      if (cancelled) {
        return;
      }

      if (availabilityResult.status === 'fulfilled') {
        setResults(availabilityResult.value.results);
      } else {
        setError(getErrorMessage(availabilityResult.reason, 'Erreur lors du chargement des disponibilités'));
        setResults([]);
      }

      if (prosResult.status === 'fulfilled') {
        setNearbyPros(prosResult.value.pros);
      } else {
        setProsError(getErrorMessage(prosResult.reason, 'Impossible de charger les pros à proximité'));
        setNearbyPros([]);
      }

      setLoadingResults(false);
      setLoadingPros(false);
    };

    void loadResults();
    return () => {
      cancelled = true;
    };
  }, [step, selectedSport, selectedLevel, distanceKm, location]);

  const mapItems = useMemo(() => {
    const availabilityMarkers = safeResults
      .filter((slot) => slot.spotLat != null && slot.spotLng != null)
      .map((slot) => {
        const isFull = slot.status === 'CLOSED' || slot.bookedCount >= slot.capacity;
        return {
          id: slot.id,
          lat: slot.spotLat as number,
          lng: slot.spotLng as number,
          displayName: slot.spotName || slot.pro.businessName || 'Spot à définir',
          distanceKm: slot.distanceKm ?? undefined,
          userId: slot.id,
          type: 'availability' as const,
          isDisabled: isFull,
          disabledReason: isFull ? 'Ce créneau est complet.' : undefined,
        };
      });

    // NearbyProResult n'a pas de lat/lng (RGPD: toPublicGeo supprime les coordonnées précises)
    return availabilityMarkers;
  }, [safeResults]);

  const handleMapContactClick = useCallback(
    (itemId: string) => {
      const slot = safeResults.find((item) => item.id === itemId);
      if (slot && slot.status !== 'CLOSED' && slot.bookedCount < slot.capacity) {
        setRequestingSlot(slot);
        return;
      }

      const pro = nearbyPros.find((item) => item.proId === itemId || `pro-${item.proId}` === itemId);
      if (pro) {
        setContactPro(pro);
      }
    },
    [safeResults, nearbyPros]
  );

  const handleRequestSubmitted = useCallback((slot: BookingAvailabilityResult) => {
    setRequestSuccess({ spotName: slot.spotName ?? null, startAt: slot.startAt });
  }, []);

  const closeRequestModal = useCallback(() => {
    setRequestingSlot(null);
  }, []);

  const handleContactSubmitted = useCallback((pro: NearbyProResult) => {
    setContactSuccess(pro.businessName ?? 'ce pro');
  }, []);

  const closeContactModal = useCallback(() => {
    setContactPro(null);
  }, []);

  const requestGeolocation = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGeoStatus('error');
      setGeoMessage('La géolocalisation n’est pas supportée par ce navigateur.');
      return;
    }
    setGeoStatus('loading');
    setGeoMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        setLocation({ lat, lng });
        setManualLat(lat.toString());
        setManualLng(lng.toString());
        setGeoStatus('success');
        setGeoMessage('Position détectée avec succès.');
      },
      (err) => {
        const code = err.code;
        if (code === err.PERMISSION_DENIED) {
          setGeoStatus('denied');
          setGeoMessage('Permission refusée. Renseigne ton spot manuellement.');
        } else {
          setGeoStatus('error');
          setGeoMessage('Impossible de récupérer ta position. Vérifie tes paramètres.');
        }
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }, []);

  const handleManualLatChange = (event: ChangeEvent<HTMLInputElement>) => {
    setManualLat(event.target.value);
  };

  const handleManualLngChange = (event: ChangeEvent<HTMLInputElement>) => {
    setManualLng(event.target.value);
  };

  const applyManualCoordinates = useCallback(() => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setGeoStatus('error');
      setGeoMessage('Coordonnées invalides. Utilise des valeurs numériques (ex: 43.493 / -1.558).');
      return;
    }
    setLocation({ lat, lng });
    setGeoStatus('success');
    setGeoMessage('Position mise à jour.');
  }, [manualLat, manualLng]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Étape {step} / 3</span>
        <Link href="/reservations">Retour</Link>
      </div>

      <ReservationStepper current={step} steps={steps} />

      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {/* Header avec gradient */}
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-sky-100 to-cyan-100 dark:from-sky-900/20 dark:to-cyan-900/20 p-4 border-2 border-sky-200/50 dark:border-sky-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 text-white shadow-md">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Trouver un moniteur</h2>
                <p className="text-sm text-muted-foreground">Étape 1 sur 3 : Sport & niveau</p>
              </div>
            </div>
            <Badge variant="secondary" className="bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400">
              Étape 1/3
            </Badge>
          </div>

          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-xl">Quel sport veux-tu pratiquer ?</CardTitle>
              <CardDescription>Sélectionne ton sport et ton niveau pour filtrer les pros</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setSelectedSport('surf')}
                  aria-pressed={selectedSport === 'surf'}
                  className={`rounded-2xl border-2 px-5 py-6 text-left transition-all shadow-sm hover:shadow-md ${
                    selectedSport === 'surf'
                      ? 'border-blue-500 bg-blue-50/80 ring-2 ring-blue-200 dark:bg-blue-900/20 dark:ring-blue-800'
                      : 'border-border hover:border-blue-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-blue-500/10 p-3">
                      <Waves className="text-blue-600 w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-semibold text-lg">Surf</p>
                      <p className="text-sm text-muted-foreground">
                        Coaching sur mesure & sessions partagées
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedSport('kitesurf')}
                  aria-pressed={selectedSport === 'kitesurf'}
                  className={`rounded-2xl border-2 px-5 py-6 text-left transition-all shadow-sm hover:shadow-md ${
                    selectedSport === 'kitesurf'
                      ? 'border-purple-500 bg-purple-50/80 ring-2 ring-purple-200 dark:bg-purple-900/20 dark:ring-purple-800'
                      : 'border-border hover:border-purple-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-purple-500/10 p-3">
                      <Wind className="text-purple-600 w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-semibold text-lg">Kitesurf</p>
                      <p className="text-sm text-muted-foreground">
                        Coaching sur mesure & sessions partagées
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold">Ton niveau actuel</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {levels.map((level) => {
                    const isSelected = selectedLevel === level.id;
                    const iconMap = {
                      beginner: Users,
                      intermediate: TrendingUp,
                      advanced: Sparkles,
                    };
                    const Icon = iconMap[level.id];

                    return (
                      <button
                        key={level.id}
                        type="button"
                        onClick={() => setSelectedLevel(level.id)}
                        className={`rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all ${
                          isSelected
                            ? 'border-teal-500 bg-teal-50/80 ring-2 ring-teal-200 dark:bg-teal-900/20 dark:ring-teal-800'
                            : 'border-border hover:border-teal-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-4 h-4 ${isSelected ? 'text-teal-600' : 'text-muted-foreground'}`} />
                          <span>{level.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <Button disabled={!canGoNextFromStep1} onClick={() => setStep(2)} size="lg">
                  Continuer
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {/* Header avec gradient */}
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-emerald-100 to-teal-100 dark:from-emerald-900/20 dark:to-teal-900/20 p-4 border-2 border-emerald-200/50 dark:border-emerald-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Zone de recherche</h2>
                <p className="text-sm text-muted-foreground">Étape 2 sur 3 : Localisation</p>
              </div>
            </div>
            <Badge variant="secondary" className="bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400">
              Étape 2/3
            </Badge>
          </div>

          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-xl">Où es-tu prêt·e à te déplacer ?</CardTitle>
              <CardDescription>Active la géolocalisation ou indique ton spot préféré</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Distance maximale</p>
                  <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                    {distanceKm} km
                  </Badge>
                </div>
                <Slider
                  defaultValue={[distanceKm]}
                  min={5}
                  max={100}
                  step={5}
                  onValueChange={(values: number[]) => setDistanceKm(values[0] ?? 25)}
                />
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold">Ta position</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="default"
                    variant="secondary"
                    onClick={requestGeolocation}
                    disabled={geoStatus === 'loading'}
                    className="gap-2"
                  >
                    <MapPin className="w-4 h-4" />
                    {geoStatus === 'loading' ? 'Détection en cours…' : 'Utiliser ma position actuelle'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Autorise la localisation dans ton navigateur ou entre un spot manuel
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Latitude
                    </label>
                    <Input
                      type="number"
                      step="any"
                      value={manualLat}
                      onChange={handleManualLatChange}
                      placeholder="Ex: 43.493"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Longitude
                    </label>
                    <Input
                      type="number"
                      step="any"
                      value={manualLng}
                      onChange={handleManualLngChange}
                      placeholder="Ex: -1.558"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={applyManualCoordinates}>
                    Valider ces coordonnées
                  </Button>
                  {location && (
                    <span className="text-xs text-muted-foreground">
                      Position actuelle : {location.lat.toFixed(3)}, {location.lng.toFixed(3)}
                    </span>
                  )}
                </div>

                {geoMessage && (
                  <StatusMessage variant={geoStatus === 'success' ? 'success' : 'error'}>
                    {geoMessage}
                  </StatusMessage>
                )}
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Retour
                </Button>
                <Button onClick={() => setStep(3)} size="lg">
                  Voir les pros disponibles
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {/* Header avec gradient */}
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-violet-100 to-purple-100 dark:from-violet-900/20 dark:to-purple-900/20 p-4 border-2 border-violet-200/50 dark:border-violet-800/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-md">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">Résultats</h2>
                <p className="text-sm text-muted-foreground">Étape 3 sur 3 : Choisis ton cours</p>
              </div>
            </div>
            <Badge variant="secondary" className="bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-400">
              Étape 3/3
            </Badge>
          </div>

          {/* Messages de succès */}
          {requestSuccess && (
            <StatusMessage variant="success">
              <div className="space-y-2">
                <p className="font-semibold">Demande envoyée avec succès !</p>
                <p>Créneau du {new Date(requestSuccess.startAt).toLocaleString('fr-FR')}</p>
                <Link className="inline-block mt-2 underline font-medium hover:text-green-600 dark:hover:text-green-400" href="/reservations/requests">
                  Voir mes demandes →
                </Link>
              </div>
            </StatusMessage>
          )}

          {contactSuccess && (
            <StatusMessage variant="info">
              <div className="space-y-1">
                <p className="font-semibold">Message envoyé !</p>
                <p>Ton message a été envoyé à {contactSuccess}. Tu peux poursuivre la conversation depuis ta messagerie.</p>
              </div>
            </StatusMessage>
          )}

          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-xl">Résultats autour de toi</CardTitle>
              <CardDescription>Créneaux publiés et pros visibles dans ton rayon</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">

            {location && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Carte des créneaux et pros</span>
                  <span className="text-xs text-muted-foreground">
                    Centre: {location.lat.toFixed(3)}, {location.lng.toFixed(3)}
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border">
                  {mapItems.length > 0 ? (
                    <AvailabilityMap
                      center={[location.lat, location.lng]}
                      items={mapItems}
                      onContactClick={handleMapContactClick}
                      highlightedItemId={highlightedItemId}
                      centerMarker={{
                        label: 'Point de recherche',
                        description: 'Les résultats sont calculés depuis cette position.',
                      }}
                      legend={[
                        { label: 'Votre position', color: '#0ea5e9' },
                        { label: 'Créneaux disponibles', color: '#2563eb' },
                        { label: 'Pros visibles', color: '#f97316' },
                      ]}
                      radiusKm={distanceKm}
                    />
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">
                      Les résultats ne disposent pas encore de localisation précise.
                    </div>
                  )}
                </div>
              </div>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Créneaux disponibles</h3>
                <Badge variant="outline">{safeResults.length} résultat(s)</Badge>
              </div>
              {loadingResults ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="border-2 animate-pulse">
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <div className="rounded-full bg-muted w-12 h-12" />
                          <div className="flex-1 space-y-2">
                            <div className="h-5 bg-muted rounded w-3/4" />
                            <div className="h-4 bg-muted rounded w-1/2" />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="h-4 bg-muted rounded w-full" />
                          <div className="h-4 bg-muted rounded w-2/3" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : error ? (
                <StatusMessage variant="error">
                  {error}
                </StatusMessage>
              ) : safeResults.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed p-8 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Calendar className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Aucun créneau trouvé dans ce rayon. Tu peux élargir la zone ou contacter directement un pro ci-dessous.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {safeResults.map((slot) => {
                    const isFull = slot.status === 'CLOSED' || slot.bookedCount >= slot.capacity;
                    const SportIcon = slot.sport === 'surf' ? Waves : Wind;

                    return (
                      <Card
                        key={slot.id}
                        className="border-2 hover:shadow-lg transition-all duration-200 hover:border-primary/50"
                        onMouseEnter={() => setHighlightedItemId(slot.id)}
                        onMouseLeave={() => setHighlightedItemId(null)}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1">
                              <div className={`rounded-full p-2.5 ${slot.sport === 'surf' ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}>
                                <SportIcon className={`w-5 h-5 ${slot.sport === 'surf' ? 'text-blue-600' : 'text-purple-600'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <CardTitle className="text-lg mb-2 flex items-center gap-2 flex-wrap">
                                  <span className="truncate">{slot.spotName || 'Spot à définir'}</span>
                                  <Badge variant="outline" className={`${slot.sport === 'surf' ? 'border-blue-500 text-blue-700 dark:text-blue-400' : 'border-purple-500 text-purple-700 dark:text-purple-400'}`}>
                                    {slot.sport}
                                  </Badge>
                                  {isFull && (
                                    <Badge variant="destructive" className="shadow-sm">Complet</Badge>
                                  )}
                                </CardTitle>
                                <CardDescription className="flex items-center gap-2 text-sm">
                                  <Calendar className="w-4 h-4" />
                                  {new Date(slot.startAt).toLocaleString('fr-FR')} → {new Date(slot.endAt).toLocaleTimeString('fr-FR')}
                                </CardDescription>
                              </div>
                            </div>
                            {slot.distanceKm != null && (
                              <Badge variant="secondary" className="shrink-0">
                                {slot.distanceKm.toFixed(1)} km
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-3">
                          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4 text-muted-foreground" />
                              <span className="text-muted-foreground">Niveaux : {slot.levels.join(', ')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">
                                {slot.bookedCount}/{slot.capacity} riders
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3 pt-2 border-t">
                            <div className="flex items-center gap-3">
                              <div className="text-sm font-medium">
                                {slot.pro.businessName ?? 'Pro'}
                              </div>
                              <RiderMiniaturesStrip riders={slot.riders} />
                            </div>
                            <Button
                              onClick={() => setRequestingSlot(slot)}
                              disabled={isFull}
                              title={isFull ? 'Tous les riders sont déjà positionnés.' : undefined}
                              className="shrink-0"
                            >
                              Demander
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Pros autour de toi</h3>
                <Badge variant="outline">{nearbyPros.length} pro(s)</Badge>
              </div>
              {loadingPros ? (
                <div className="space-y-4">
                  {[1, 2].map((i) => (
                    <Card key={i} className="border-2 animate-pulse">
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <div className="rounded-full bg-muted w-12 h-12" />
                          <div className="flex-1 space-y-2">
                            <div className="h-5 bg-muted rounded w-3/4" />
                            <div className="h-4 bg-muted rounded w-1/2" />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="h-4 bg-muted rounded w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : prosError ? (
                <StatusMessage variant="error">
                  {prosError}
                </StatusMessage>
              ) : nearbyPros.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed p-8 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Users className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Aucun pro visible dans ce rayon. Vérifie ta localisation ou élargis la recherche.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {nearbyPros.map((pro) => {
                    const hasAvailability = pro.openAvailabilityCount > 0;

                    return (
                      <Card
                        key={pro.proId}
                        className="border-2 hover:shadow-lg transition-all duration-200 hover:border-primary/50"
                        onMouseEnter={() => setHighlightedItemId(`pro-${pro.proId}`)}
                        onMouseLeave={() => setHighlightedItemId(null)}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1">
                              <div className="rounded-full bg-gradient-to-br from-sky-500 to-cyan-500 p-2.5 text-white shadow-md">
                                <Users className="w-5 h-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <CardTitle className="text-lg mb-2 flex items-center gap-2 flex-wrap">
                                  <span className="truncate">{pro.businessName ?? 'Pro'}</span>
                                  {pro.verified && (
                                    <Badge variant="default" className="bg-green-500 hover:bg-green-600 shadow-sm">
                                      ✓ Vérifié
                                    </Badge>
                                  )}
                                  {!hasAvailability && (
                                    <Badge variant="outline" className="text-amber-700 border-amber-500 dark:text-amber-400">
                                      Pas de créneau
                                    </Badge>
                                  )}
                                </CardTitle>
                                <CardDescription className="flex items-center gap-2 text-sm">
                                  {pro.sports.length > 0 ? (
                                    <>
                                      {pro.sports.map((sport) => (
                                        <Badge key={sport} variant="secondary" className="text-xs">
                                          {sport}
                                        </Badge>
                                      ))}
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground italic">Sport non renseigné</span>
                                  )}
                                </CardDescription>
                              </div>
                            </div>
                            {pro.distanceKm != null && (
                              <Badge variant="secondary" className="shrink-0">
                                {pro.distanceKm.toFixed(1)} km
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="pt-3">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t">
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              <MapPin className="w-4 h-4" />
                              <span>Rayon : {distanceKm} km · Contact direct disponible</span>
                            </div>
                            <Button variant="default" onClick={() => setContactPro(pro)} className="shrink-0 w-full sm:w-auto">
                              Contacter le pro
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Retour
              </Button>
              <Button asChild variant="secondary">
                <Link href="/reservations/requests">Voir mes demandes</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      <Dialog open={!!requestingSlot} onOpenChange={(open) => !open && closeRequestModal()}>
        <DialogContent>
          {requestingSlot && (
            <RequestBookingForm
              slot={requestingSlot}
              onSubmitted={(slot) => {
                handleRequestSubmitted(slot);
                closeRequestModal();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ContactProModal
        pro={contactPro}
        onClose={closeContactModal}
        onSubmitted={(pro) => {
          handleContactSubmitted(pro);
          closeContactModal();
        }}
      />
    </div>
  );
}

interface RequestBookingFormProps {
  slot: BookingAvailabilityResult;
  onSubmitted: (slot: BookingAvailabilityResult) => void;
}

function RequestBookingForm({ slot, onSubmitted }: RequestBookingFormProps) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAt = new Date(slot.startAt);
  const endAt = new Date(slot.endAt);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError(null);
      await apiClient.createBookingRequest({
        availabilityId: slot.id,
        message: message.trim() ? message.trim() : undefined,
      });
      onSubmitted(slot);
    } catch (err) {
      setError(getErrorMessage(err, "Impossible d'envoyer la demande"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Demander ce créneau</DialogTitle>
        <DialogDescription>
          {slot.spotName || 'Spot à définir'} · {startAt.toLocaleDateString('fr-FR')} {startAt.toLocaleTimeString('fr-FR')} – {endAt.toLocaleTimeString('fr-FR')}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <label className="text-sm font-medium">Message au pro (optionnel)</label>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={4}
          className="w-full rounded-md border px-3 py-2 text-sm"
          placeholder="Dis bonjour, précise ton niveau ou tes attentes."
        />
        <p className="text-xs text-muted-foreground">
          Ton message sera envoyé uniquement au pro concerné.
        </p>
      </div>

      {error && (
        <StatusMessage variant="error">
          {error}
        </StatusMessage>
      )}

      <DialogFooter>
        <Button type="submit" disabled={saving} aria-busy={saving}>
          {saving ? 'Envoi…' : 'Envoyer la demande'}
        </Button>
      </DialogFooter>
    </form>
  );
}
