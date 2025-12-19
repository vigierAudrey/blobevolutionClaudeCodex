"use client";

// Force SSR for dynamic user-specific features
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import dynamicImport from 'next/dynamic';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Slider } from '../../../components/ui/slider';
import { ReservationStepper } from '../../../components/reservations/ReservationStepper';
import { RiderMiniaturesStrip } from '../../../components/reservations/RiderMiniaturesStrip';
import { apiClient, type BookingAvailabilityResult, type NearbyProResult } from '../../../lib/apiClient';

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

const sports: Array<{ id: 'surf' | 'kitesurf'; label: string }> = [
  { id: 'surf', label: 'Surf' },
  { id: 'kitesurf', label: 'Kitesurf' },
];

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
          displayName: slot.spotName || slot.pro.businessName || slot.pro.email,
          distanceKm: slot.distanceKm ?? undefined,
          userId: slot.id,
          type: 'availability' as const,
          isDisabled: isFull,
          disabledReason: isFull ? 'Ce créneau est complet.' : undefined,
        };
      });

    const proMarkers = nearbyPros.map((pro) => ({
      id: `pro-${pro.proId}`,
      lat: pro.lat,
      lng: pro.lng,
      displayName: pro.businessName || pro.email,
      distanceKm: pro.distanceKm,
      userId: pro.proId,
      type: 'default' as const,
      isDisabled: false,
      disabledReason: pro.openAvailabilityCount === 0 ? 'Pas de créneau publié' : undefined,
    }));

    return [...availabilityMarkers, ...proMarkers];
  }, [safeResults, nearbyPros]);

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
    setContactSuccess(pro.businessName ?? pro.email);
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
        <Card>
          <CardHeader>
            <CardTitle>Quel sport veux-tu pratiquer ?</CardTitle>
            <CardDescription>Sélectionne ton sport et ton niveau pour filtrer les pros.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sports.map((sport) => (
                <button
                  key={sport.id}
                  type="button"
                  className={`border rounded-lg px-4 py-3 text-left transition ${
                    selectedSport === sport.id ? 'border-primary bg-primary/5' : 'hover:border-primary'
                  }`}
                  onClick={() => setSelectedSport(sport.id)}
                >
                  <div className="font-medium">{sport.label}</div>
                  <div className="text-xs text-muted-foreground">Coaching sur mesure & sessions partagées</div>
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Ton niveau actuel</p>
              <div className="flex flex-wrap gap-2">
                {levels.map((level) => (
                  <Badge
                    key={level.id}
                    variant={selectedLevel === level.id ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setSelectedLevel(level.id)}
                  >
                    {level.label}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button disabled={!canGoNextFromStep1} onClick={() => setStep(2)}>
                Continuer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Où es-tu prêt·e à te déplacer ?</CardTitle>
            <CardDescription>Active la géolocalisation ou indique ton spot préféré.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-medium">Distance maximale ({distanceKm} km)</p>
              <Slider
                defaultValue={[distanceKm]}
                min={5}
                max={100}
                step={5}
                onValueChange={(values: number[]) => setDistanceKm(values[0] ?? 25)}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Position</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={requestGeolocation} disabled={geoStatus === 'loading'}>
                  {geoStatus === 'loading' ? 'Détection en cours…' : 'Utiliser ma position actuelle'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Autorise la localisation dans ton navigateur ou entre un spot manuel.
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Latitude
                  <input
                    type="number"
                    step="any"
                    value={manualLat}
                    onChange={handleManualLatChange}
                    className="rounded-md border px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Longitude
                  <input
                    type="number"
                    step="any"
                    value={manualLng}
                    onChange={handleManualLngChange}
                    className="rounded-md border px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={applyManualCoordinates}>
                  Valider ces coordonnées
                </Button>
                {location && (
                  <span className="text-xs text-muted-foreground">
                    Utilisées actuellement : {location.lat.toFixed(3)}, {location.lng.toFixed(3)}
                  </span>
                )}
              </div>
              {geoMessage && (
                <p className={`text-xs ${geoStatus === 'success' ? 'text-green-600' : 'text-red-600'}`}>{geoMessage}</p>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Retour
              </Button>
              <Button onClick={() => setStep(3)}>Voir les pros disponibles</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Résultats autour de toi</CardTitle>
            <CardDescription>Créneaux publiés et pros visibles dans ton rayon.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {requestSuccess && (
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                Demande envoyée pour le créneau du {new Date(requestSuccess.startAt).toLocaleString('fr-FR')}.
                <div className="mt-2">
                  <Link className="underline" href="/reservations/requests">
                    Voir mes demandes
                  </Link>
                </div>
              </div>
            )}

            {contactSuccess && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Message envoyé à {contactSuccess}. Tu peux poursuivre la conversation depuis ta messagerie.
              </div>
            )}

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
                <h3 className="text-base font-semibold">Slots disponibles</h3>
                <Badge variant="outline">{safeResults.length} résultat(s)</Badge>
              </div>
              {loadingResults ? (
                <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                  Chargement des créneaux disponibles…
                </div>
              ) : error ? (
                <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                  {error}
                </div>
              ) : safeResults.length === 0 ? (
                <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                  Aucun créneau trouvé dans ce rayon. Tu peux élargir la zone ou contacter directement un pro ci-dessous.
                </div>
              ) : (
                <div className="space-y-4">
                  {safeResults.map((slot) => (
                    <Card key={slot.id}>
                      <CardHeader className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <CardTitle className="flex items-center gap-2 text-base">
                            {slot.spotName || 'Spot à définir'}
                            <Badge variant="secondary">{slot.sport}</Badge>
                            {(slot.status === 'CLOSED' || slot.bookedCount >= slot.capacity) && (
                              <Badge variant="destructive">Complet</Badge>
                            )}
                          </CardTitle>
                          {slot.distanceKm != null && (
                            <span className="text-xs text-muted-foreground">{slot.distanceKm.toFixed(1)} km</span>
                          )}
                        </div>
                        <CardDescription>
                          {new Date(slot.startAt).toLocaleString('fr-FR')} → {new Date(slot.endAt).toLocaleTimeString('fr-FR')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>Niveaux acceptés : {slot.levels.join(', ')}</span>
                          <span>
                            {slot.bookedCount}/{slot.capacity} riders positionnés
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">
                            {slot.pro.businessName || slot.pro.email}
                          </div>
                          <RiderMiniaturesStrip riders={slot.riders} />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          {(slot.status === 'CLOSED' || slot.bookedCount >= slot.capacity) && (
                            <span className="text-xs text-red-700 dark:text-red-300 font-semibold">Créneau complet</span>
                          )}
                          <Button
                            size="sm"
                            onClick={() => setRequestingSlot(slot)}
                            disabled={slot.status === 'CLOSED' || slot.bookedCount >= slot.capacity}
                            title={slot.status === 'CLOSED' || slot.bookedCount >= slot.capacity ? 'Tous les riders sont déjà positionnés.' : undefined}
                          >
                            Demander ce créneau
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Pros autour de toi</h3>
                <Badge variant="outline">{nearbyPros.length} pro(s)</Badge>
              </div>
              {loadingPros ? (
                <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                  Chargement des pros à proximité…
                </div>
              ) : prosError ? (
                <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                  {prosError}
                </div>
              ) : nearbyPros.length === 0 ? (
                <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
                  Aucun pro visible dans ce rayon. Vérifie ta localisation ou élargis la recherche.
                </div>
              ) : (
                <div className="space-y-4">
                  {nearbyPros.map((pro) => (
                    <Card key={pro.proId}>
                      <CardHeader className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="flex items-center gap-2 text-base">
                            {pro.businessName || pro.email}
                            {pro.verified && <Badge variant="secondary">Vérifié</Badge>}
                            {pro.openAvailabilityCount === 0 && (
                              <Badge variant="outline">Pas de créneau publié</Badge>
                            )}
                          </CardTitle>
                          {pro.distanceKm != null && (
                            <span className="text-xs text-muted-foreground">{pro.distanceKm.toFixed(1)} km</span>
                          )}
                        </div>
                        <CardDescription>
                          {pro.sports.length > 0
                            ? `Propose ${pro.sports.join(', ')}`
                            : 'Sport non renseigné : envoie un message pour préciser ton besoin.'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-muted-foreground">
                          Rayon de visibilité : {distanceKm} km · Contact direct même sans créneau.
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => setContactPro(pro)}>
                          Envoyer un message / Demander un cours
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
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
      )}

      <RequestBookingModal
        slot={requestingSlot}
        onClose={closeRequestModal}
        onSubmitted={(slot) => {
          handleRequestSubmitted(slot);
          closeRequestModal();
        }}
      />
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

interface RequestBookingModalProps {
  slot: BookingAvailabilityResult | null;
  onClose: () => void;
  onSubmitted: (slot: BookingAvailabilityResult) => void;
}

function RequestBookingModal({ slot, onClose, onSubmitted }: RequestBookingModalProps) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slot) {
      setMessage('');
      setSaving(false);
      setError(null);
    }
  }, [slot]);

  if (!slot) {
    return null;
  }

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
      setError(getErrorMessage(err, 'Impossible d’envoyer la demande'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Demander ce créneau</h2>
            <p className="text-sm text-muted-foreground">
              {slot.spotName || 'Spot à définir'} · {startAt.toLocaleDateString('fr-FR')} {startAt.toLocaleTimeString('fr-FR')} – {endAt.toLocaleTimeString('fr-FR')}
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
            disabled={saving}
          >
            Fermer
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <p className="font-medium">Message au pro (optionnel)</p>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Dis bonjour, précise ton niveau ou tes attentes."
          />
          <p className="text-xs text-muted-foreground">
            Ton message sera envoyé uniquement au pro concerné.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button type="submit" disabled={saving} aria-busy={saving}>
            {saving ? 'Envoi…' : 'Envoyer la demande'}
          </Button>
        </div>
      </form>
    </div>
  );
}

interface ContactProModalProps {
  pro: NearbyProResult | null;
  onClose: () => void;
  onSubmitted: (pro: NearbyProResult) => void;
}

const COOLDOWN_SECONDS = 30;

function getEnvKey() {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_ENV) {
    return process.env.NEXT_PUBLIC_APP_ENV;
  }
  return 'local';
}

function getCooldownKey(proId: string) {
  return `blob:contactCooldown:${getEnvKey()}:${proId}`;
}

export function ContactProModal({ pro, onClose, onSubmitted }: ContactProModalProps) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!pro) {
      setMessage('');
      setSaving(false);
      setError(null);
      setCooldown(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(getCooldownKey(pro.proId));
      if (stored) {
        const expiresAt = Number(stored);
        const remainingMs = expiresAt - Date.now();
        if (remainingMs > 0) {
          setCooldown(Math.ceil(remainingMs / 1000));
        } else {
          window.localStorage.removeItem(getCooldownKey(pro.proId));
          setCooldown(0);
        }
      }
    }
  }, [pro]);

  useEffect(() => {
    if (cooldown <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      setCooldown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(getCooldownKey(pro?.proId ?? ''));
          }
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cooldown, pro?.proId]);

  if (!pro) {
    return null;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!message.trim()) {
      setError('Ajoute un message pour expliquer ta demande.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const conversation = await apiClient.openConversation(pro.proId);
      await apiClient.sendMessage(conversation.id, { type: 'TEXT', content: message.trim() });
      onSubmitted(pro);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const bodyMessage = (err as { body?: { message?: string } })?.body?.message;
      if (status === 429) {
        const retry = typeof bodyMessage === 'string' && (err as { body?: { retryAfterSeconds?: number } })?.body?.retryAfterSeconds;
        const nextCooldown = typeof retry === 'number' && retry > 0 ? retry : COOLDOWN_SECONDS;
        setCooldown(nextCooldown);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(getCooldownKey(pro.proId), (Date.now() + nextCooldown * 1000).toString());
        }
        setError(bodyMessage || 'Trop de tentatives. Attends 30 secondes avant de renvoyer un message.');
      } else {
        setError(getErrorMessage(err, 'Impossible d’envoyer ton message.'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Contacter {pro.businessName || pro.email}</h2>
            <p className="text-sm text-muted-foreground">
              Tu peux demander un cours ou te présenter, même sans créneau publié.
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
            disabled={saving}
          >
            Fermer
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <p className="font-medium">Message au pro</p>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Présente-toi et décris ton besoin (dates, spot préféré, niveau…)."
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={saving || cooldown > 0}
            aria-busy={saving}
            aria-live="polite"
            title={cooldown > 0 ? `Réessayer dans ${cooldown}s` : undefined}
          >
            {saving
              ? 'Envoi…'
              : cooldown > 0
                ? `Réessayer dans ${cooldown}s`
                : 'Envoyer le message'}
          </Button>
        </div>
      </form>
    </div>
  );
}
