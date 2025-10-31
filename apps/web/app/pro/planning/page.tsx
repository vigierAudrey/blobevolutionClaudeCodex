"use client";

// Force SSR for dynamic pro/messaging features
export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import dynamicImport from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { PlusCircle, CalendarDays, Users, Mail } from 'lucide-react';
import { apiClient } from '../../../lib/apiClient';
import type {
  BookingAvailability,
  BookingRequestInboxItem,
  AvailabilityLevel,
  AvailabilitySport,
  CreateBookingAvailabilityPayload,
} from '../../../lib/types/booking';
import type { DashboardUser } from '@/types/user';

type AvailabilityView = BookingAvailability;
interface RequestView extends BookingRequestInboxItem {}


const STORAGE_KEY = 'pro-planning:last-slot';
const STORAGE_VERSION = 1;

export default function ProPlanningPage() {
  const router = useRouter();
  const [view, setView] = useState<'calendar' | 'list'>('list');
  const [availabilities, setAvailabilities] = useState<AvailabilityView[]>([]);
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionLoadingId, setDecisionLoadingId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingAvailability, setEditingAvailability] = useState<AvailabilityView | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async ({ silent } = { silent: false }) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      const [availabilityRes, requestsRes] = await Promise.all([
        apiClient.getBookingAvailabilitiesForPro(),
        apiClient.getBookingRequestsInbox(),
      ]);
      setAvailabilities(availabilityRes.availabilities);
      setRequests(requestsRes.requests);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur de chargement du planning';
      setError(message);
    } finally {
      if (!silent) {
        setLoading(false);
      }
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
        if (u.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }
        void loadData();
      })
      .catch(() => router.replace('/login'));
  }, [loadData, router]);

  const onDecision = async (id: string, decision: 'ACCEPT' | 'REJECT') => {
    try {
      setDecisionLoadingId(id);
      await apiClient.decideBookingRequest(id, decision);
      await loadData({ silent: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Impossible de traiter la demande';
      setError(message);
    } finally {
      setDecisionLoadingId(null);
    }
  };

  const handleAvailabilityCreated = useCallback(async () => {
    await loadData({ silent: true });
  }, [loadData]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer ce créneau ? Cette action est irréversible.')) {
      return;
    }
    try {
      setDeletingId(id);
      setError(null);
      await apiClient.deleteBookingAvailability(id);
      await loadData({ silent: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Impossible de supprimer le créneau';
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const pendingRequests = useMemo(() => requests.filter((req) => req.status === 'PENDING'), [requests]);
  const pendingCount = pendingRequests.length;

  const sortedAvailabilities = useMemo(
    () =>
      [...availabilities].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [availabilities]
  );

  if (loading) {
    return <p className="max-w-5xl mx-auto py-6 text-sm text-muted-foreground">Chargement du planning…</p>;
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Planning pro</h1>
          <p className="text-muted-foreground text-sm">
            Gère tes créneaux, tes demandes ({pendingCount} en attente) et tes sessions confirmées.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')}>
            <CalendarDays className="h-4 w-4 mr-2" /> Vue liste
          </Button>
          <Button variant={view === 'calendar' ? 'default' : 'outline'} onClick={() => setView('calendar')}>
            <Users className="h-4 w-4 mr-2" /> Vue calendrier
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-2" /> Ajouter un créneau
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {view === 'list' ? (
        <section className="space-y-4">
          {sortedAvailabilities.map((slot) => (
            <Card key={slot.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {slot.spotName || 'Lieu à définir'}
                    <Badge variant="secondary">{slot.sport}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {new Date(slot.startAt).toLocaleString('fr-FR')} → {new Date(slot.endAt).toLocaleTimeString('fr-FR')}
                  </CardDescription>
                </div>
                <Badge variant={slot.status === 'OPEN' ? 'outline' : 'destructive'}>{slot.status}</Badge>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 text-sm">
                <div className="space-y-1">
                  <p className="text-muted-foreground">Niveaux acceptés : {slot.levels.join(', ')}</p>
                  <p>{slot.bookedCount}/{slot.capacity} riders positionnés</p>
                  {slot.spotName && slot.spotLat && slot.spotLng && (
                    <p className="text-xs text-muted-foreground">
                      📍 <a
                        href={`https://www.google.com/maps?q=${slot.spotLat},${slot.spotLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground"
                      >
                        {slot.spotName}
                      </a>
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingAvailability(slot)}
                    disabled={deletingId === slot.id}
                  >
                    Modifier
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(slot.id)}
                    disabled={deletingId === slot.id}
                    aria-busy={deletingId === slot.id}
                  >
                    {deletingId === slot.id ? 'Suppression...' : 'Supprimer'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {sortedAvailabilities.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Aucun créneau pour le moment – ajoute ton premier créneau pour être visible dans les recherches riders.
              </CardContent>
            </Card>
          )}
        </section>
      ) : (
        <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
          Vue calendrier interactive à venir.
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> Demandes en attente
              <Badge variant={pendingCount > 0 ? 'secondary' : 'outline'}>{pendingCount}</Badge>
            </CardTitle>
            <CardDescription>Les riders intéressés par tes créneaux s’affichent ici.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {pendingRequests.length === 0 ? (
              <p className="text-muted-foreground">Aucune demande pour l’instant.</p>
            ) : (
              pendingRequests.map((req) => (
                <div key={req.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{req.riderName}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(req.createdAt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  {req.availability && (
                    <p className="text-muted-foreground">
                      Créneau : {req.availability.spotName || 'Lieu à définir'} — {new Date(req.availability.startAt).toLocaleString('fr-FR')}
                    </p>
                  )}
                  {req.message && <p className="italic text-muted-foreground">« {req.message} »</p>}
                  <Badge variant="outline">{req.status}</Badge>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => onDecision(req.id, 'ACCEPT')}
                      disabled={decisionLoadingId === req.id}
                      aria-busy={decisionLoadingId === req.id}
                    >
                      Accepter
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDecision(req.id, 'REJECT')}
                      disabled={decisionLoadingId === req.id}
                      aria-busy={decisionLoadingId === req.id}
                    >
                      Refuser
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Historique</CardTitle>
            <CardDescription>Sessions confirmées et demandes passées (à venir).</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            TODO: tableau des demandes passées + filtres.
          </CardContent>
        </Card>
      </section>

      <CreateAvailabilityModal
        open={isCreateOpen || editingAvailability !== null}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingAvailability(null);
        }}
        onCreated={handleAvailabilityCreated}
        editingAvailability={editingAvailability}
      />
    </div>
  );
}

interface CreateAvailabilityModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  editingAvailability?: AvailabilityView | null;
}

type CreateAvailabilityFormState = {
  sport: AvailabilitySport;
  levels: AvailabilityLevel[];
  date: string;
  startTime: string;
  duration: number;
  capacity: number;
  spotName: string;
  spotLat: string;
  spotLng: string;
};

const defaultCreateFormState: CreateAvailabilityFormState = {
  sport: 'surf',
  levels: ['beginner'],
  date: '',
  startTime: '',
  duration: 90,
  capacity: 4,
  spotName: '',
  spotLat: '',
  spotLng: '',
};

function CreateAvailabilityModal({ open, onClose, onCreated, editingAvailability }: CreateAvailabilityModalProps) {
  const [form, setForm] = useState<CreateAvailabilityFormState>(defaultCreateFormState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [hasStoredPrefs, setHasStoredPrefs] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ label: string; lat: number; lng: number }>>([]);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [spotNameEdited, setSpotNameEdited] = useState(false);

  const skipGeocodeRef = useRef(false);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const geocodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseAbortRef = useRef<AbortController | null>(null);
  const reverseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restorePreferences = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        version: number;
        data: CreateAvailabilityFormState;
      };
      if (parsed.version !== STORAGE_VERSION) {
        return;
      }
      setForm(parsed.data);
      setHasStoredPrefs(true);
      skipGeocodeRef.current = true;
      setAddressQuery(parsed.data.spotName ?? '');
      setAddressSuggestions([]);
      setGeocodeError(null);
      setSpotNameEdited(false);
    } catch (err) {
      console.warn('[CreateAvailabilityModal] unable to restore preferences', err);
    }
  }, []);

  useEffect(() => {
    if (!editingAvailability) {
      restorePreferences();
    }
  }, [restorePreferences, editingAvailability]);

  useEffect(() => {
    if (!open) {
      setForm(defaultCreateFormState);
      setSaving(false);
      setError(null);
      setShowMap(false);
      setHasStoredPrefs(false);
      setAddressQuery('');
      setAddressSuggestions([]);
      setGeocodeError(null);
      setSpotNameEdited(false);
      if (!editingAvailability) {
        restorePreferences();
      }
    }
  }, [open, restorePreferences, editingAvailability]);

  // Pré-remplir le formulaire en mode édition
  useEffect(() => {
    if (open && editingAvailability) {
      const startDate = new Date(editingAvailability.startAt);
      const endDate = new Date(editingAvailability.endAt);
      const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60_000);

      setForm({
        sport: editingAvailability.sport,
        levels: editingAvailability.levels,
        date: startDate.toISOString().split('T')[0],
        startTime: startDate.toTimeString().slice(0, 5),
        duration: durationMinutes,
        capacity: editingAvailability.capacity,
        spotName: editingAvailability.spotName ?? '',
        spotLat: editingAvailability.spotLat?.toString() ?? '',
        spotLng: editingAvailability.spotLng?.toString() ?? '',
      });

      setAddressQuery(editingAvailability.spotName ?? '');
      if (editingAvailability.spotLat && editingAvailability.spotLng) {
        setShowMap(true);
      }
      setSpotNameEdited(false);
      setAddressSuggestions([]);
      setGeocodeError(null);
    }
  }, [open, editingAvailability]);

  const LocationPickerMap = useMemo(
    () =>
      dynamicImport(() => import('../../../components/LocationPickerMap'), {
        ssr: false,
        loading: () => (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Chargement de la carte…
          </div>
        ),
      }),
    []
  );

  useEffect(() => {
    return () => {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
      }
      geocodeAbortRef.current?.abort();
      if (reverseTimeoutRef.current) {
        clearTimeout(reverseTimeoutRef.current);
      }
      reverseAbortRef.current?.abort();
    };
  }, []);

  const triggerReverseLookup = useCallback(
    (lat: number, lng: number) => {
      if (reverseTimeoutRef.current) {
        clearTimeout(reverseTimeoutRef.current);
      }

      reverseTimeoutRef.current = setTimeout(async () => {
        reverseAbortRef.current?.abort();
        const controller = new AbortController();
        reverseAbortRef.current = controller;

        setReverseLoading(true);
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=fr`,
            { signal: controller.signal }
          );
          if (!response.ok) {
            throw new Error('Reverse geocoding failed');
          }
          const payload = (await response.json()) as { display_name?: string };
          const displayName = payload?.display_name;
          if (displayName) {
            skipGeocodeRef.current = true;
            setAddressQuery(displayName);
            setGeocodeError(null);
            if (!spotNameEdited) {
              setForm((prev) => ({ ...prev, spotName: displayName }));
            }
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          setGeocodeError('Impossible de récupérer l’adresse exacte.');
        } finally {
          setReverseLoading(false);
        }
      }, 450);
    },
    [spotNameEdited]
  );

  const updateCoordinates = useCallback(
    (lat: number, lng: number, options?: { skipReverse?: boolean }) => {
      setForm((prev) => ({
        ...prev,
        spotLat: lat.toFixed(6),
        spotLng: lng.toFixed(6),
      }));
      if (!options?.skipReverse) {
        triggerReverseLookup(lat, lng);
      }
    },
    [triggerReverseLookup]
  );

  const applyGeocodingResult = useCallback(
    (label: string, lat: number, lng: number) => {
      skipGeocodeRef.current = true;
      setAddressQuery(label);
      setAddressSuggestions([]);
      setGeocodeError(null);
      setSpotNameEdited(false);
      updateCoordinates(lat, lng, { skipReverse: true });
      setForm((prev) => ({ ...prev, spotName: label }));
      setShowMap(true);
    },
    [updateCoordinates]
  );

  const handleManualCoordinates = useCallback(() => {
    const lat = Number(form.spotLat);
    const lng = Number(form.spotLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setGeocodeError('Coordonnées invalides (ex: 43.493 / -1.558).');
      return;
    }
    setShowMap(true);
    setGeocodeError(null);
    updateCoordinates(lat, lng);
  }, [form.spotLat, form.spotLng, updateCoordinates]);

  useEffect(() => {
    if (skipGeocodeRef.current) {
      skipGeocodeRef.current = false;
      return;
    }

    const trimmed = addressQuery.trim();

    if (!trimmed) {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
        geocodeTimeoutRef.current = null;
      }
      geocodeAbortRef.current?.abort();
      setAddressSuggestions([]);
      setGeocodeError(null);
      setGeocodeLoading(false);
      return;
    }

    if (trimmed.length < 3) {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
        geocodeTimeoutRef.current = null;
      }
      setAddressSuggestions([]);
      setGeocodeError('Saisis au moins 3 caractères.');
      setGeocodeLoading(false);
      return;
    }

    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }
    geocodeAbortRef.current?.abort();
    const controller = new AbortController();
    geocodeAbortRef.current = controller;

    geocodeTimeoutRef.current = setTimeout(async () => {
      try {
        setGeocodeLoading(true);
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=fr&accept-language=fr&q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error('Service géocodage indisponible');
        }
        type NominatimResult = {
          display_name: string;
          lat: string;
          lon?: string;
          lng?: string;
          importance?: number;
        };
        const payload = (await response.json()) as Array<NominatimResult>;
        const enriched = payload
          .map((item) => {
            const lat = Number(item.lat);
            const lon = item.lon ?? item.lng;
            const lng = lon !== undefined ? Number(lon) : Number.NaN;
            return {
              label: item.display_name,
              lat,
              lng,
              importance: item.importance ?? 0,
            };
          })
          .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
        enriched.sort((a, b) => b.importance - a.importance);
        setAddressSuggestions(enriched.map(({ label, lat, lng }) => ({ label, lat, lng })));
        setGeocodeError(enriched.length === 0 ? 'Aucun résultat trouvé.' : null);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setAddressSuggestions([]);
        const message = err instanceof Error ? err.message : 'Erreur lors de la recherche d’adresse.';
        setGeocodeError(message);
      } finally {
        setGeocodeLoading(false);
      }
    }, 450);

    return () => {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
        geocodeTimeoutRef.current = null;
      }
      controller.abort();
      geocodeAbortRef.current = null;
    };
  }, [addressQuery]);

  const computedEndDate = useMemo(() => {
    if (!form.date || !form.startTime) return null;
    const start = new Date(`${form.date}T${form.startTime}`);
    if (Number.isNaN(start.getTime())) return null;
    return new Date(start.getTime() + form.duration * 60_000);
  }, [form.date, form.startTime, form.duration]);

  const toggleLevel = (level: AvailabilityLevel) => {
    setForm((prev) => {
      const exists = prev.levels.includes(level);
      const nextLevels = exists ? prev.levels.filter((lvl) => lvl !== level) : [...prev.levels, level];
      return { ...prev, levels: nextLevels };
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!form.date || !form.startTime) {
      setError('Sélectionne une date et une heure de début.');
      return;
    }

    if (form.levels.length === 0) {
      setError('Sélectionne au moins un niveau.');
      return;
    }

    if (form.duration <= 0) {
      setError('Choisis une durée valide.');
      return;
    }

    const start = new Date(`${form.date}T${form.startTime}`);
    if (Number.isNaN(start.getTime())) {
      setError('Date ou heure invalide.');
      return;
    }

    const end = new Date(start.getTime() + form.duration * 60_000);

    const latProvided = form.spotLat.trim() !== '';
    const lngProvided = form.spotLng.trim() !== '';

    if (latProvided !== lngProvided) {
      setError('Renseigne la latitude et la longitude, ou laisse les deux champs vides.');
      return;
    }

    const spotLat = latProvided ? Number(form.spotLat) : undefined;
    const spotLng = lngProvided ? Number(form.spotLng) : undefined;

    if ((latProvided && Number.isNaN(spotLat)) || (lngProvided && Number.isNaN(spotLng))) {
      setError('Coordonnées GPS invalides.');
      return;
    }

    const payload = {
      sport: form.sport,
      levels: form.levels,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      capacity: form.capacity,
      spotName: form.spotName.trim() ? form.spotName.trim() : undefined,
      spotLat,
      spotLng,
    } satisfies CreateBookingAvailabilityPayload;

    try {
      setSaving(true);
      if (editingAvailability) {
        // Mode édition : PATCH
        await apiClient.updateBookingAvailability(editingAvailability.id, payload);
      } else {
        // Mode création : POST
        await apiClient.createBookingAvailability(payload);
        // Sauvegarder les préférences uniquement en création
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ version: STORAGE_VERSION, data: form })
            );
            setHasStoredPrefs(true);
          } catch (err) {
            console.warn('[CreateAvailabilityModal] unable to persist preferences', err);
          }
        }
      }
      await onCreated();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined;
      setError(
        message || (editingAvailability ? 'Impossible de modifier le créneau' : 'Impossible de créer le créneau')
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return null;
  }

  const formattedEnd = computedEndDate
    ? computedEndDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const sportOptions: Array<{ value: AvailabilitySport; label: string }> = [
    { value: 'surf', label: 'Surf' },
    { value: 'kitesurf', label: 'Kitesurf' },
  ];

  const levelOptions: Array<{ value: AvailabilityLevel; label: string }> = [
    { value: 'beginner', label: 'Débutant' },
    { value: 'intermediate', label: 'Intermédiaire' },
    { value: 'advanced', label: 'Avancé' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {editingAvailability ? 'Modifier le créneau' : 'Ajouter un créneau'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {editingAvailability
                ? 'Modifie les détails de ton créneau.'
                : 'Prépare un créneau (sport, niveaux, horaires et lieu).'}
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

        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Sport
              <select
                value={form.sport}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sport: event.target.value as AvailabilitySport }))
                }
                className="rounded-md border px-2 py-1"
              >
                {sportOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Capacité
              <input
                type="number"
                min={1}
                max={20}
                value={form.capacity}
                onChange={(event) =>
                  setForm((prev) => {
                    const next = Number(event.target.value);
                    if (Number.isNaN(next)) return prev;
                    const clamped = Math.min(20, Math.max(1, next));
                    return { ...prev, capacity: clamped };
                  })
                }
                className="rounded-md border px-2 py-1"
              />
            </label>
          </div>

          <fieldset className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            <legend className="text-xs font-semibold uppercase text-muted-foreground">Niveaux acceptés</legend>
            <div className="flex flex-wrap gap-3">
              {levelOptions.map((option) => {
                const checked = form.levels.includes(option.value);
                return (
                  <label key={option.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLevel(option.value)}
                      className="h-4 w-4"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                className="rounded-md border px-2 py-1"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Heure de début
              <input
                type="time"
                value={form.startTime}
                onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))}
                className="rounded-md border px-2 py-1"
                required
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Durée (heures)
            <input
              type="number"
              min={0.5}
              max={4}
              step={0.25}
              value={form.duration / 60}
              onChange={(event) =>
                setForm((prev) => {
                  const nextHours = Number(event.target.value);
                  if (Number.isNaN(nextHours)) return prev;
                  const clampedHours = Math.min(4, Math.max(0.5, nextHours));
                  const minutes = Math.round(clampedHours * 60);
                  return { ...prev, duration: minutes };
                })
              }
              className="rounded-md border px-2 py-1"
              required
            />
            <span className="text-xs text-muted-foreground">{form.duration} min au total</span>
            {formattedEnd && (
              <span className="text-xs text-muted-foreground">Fin estimée à {formattedEnd}</span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Nom du spot
            <input
              type="text"
              value={form.spotName}
              onChange={(event) => {
                setSpotNameEdited(true);
                setForm((prev) => ({ ...prev, spotName: event.target.value }));
              }}
              placeholder="Ex: Plage Centrale"
              className="rounded-md border px-2 py-1"
            />
          </label>

          <div className="space-y-2 text-sm">
            <label className="flex flex-col gap-1">
              Adresse (optionnelle)
              <input
                type="text"
                value={addressQuery}
                onChange={(event) => {
                  setAddressQuery(event.target.value);
                  setGeocodeError(null);
                }}
                placeholder="Ex: 12 avenue des Dunes, Biarritz"
                className="rounded-md border px-2 py-1"
              />
            </label>
            <div className="min-h-[1.25rem] text-xs text-muted-foreground">
              {geocodeLoading ? 'Recherche en cours…' : reverseLoading ? 'Mise à jour de l’adresse…' : ' '}
            </div>
            {geocodeError && (
              <p className="text-xs text-red-600" role="alert">
                {geocodeError}
              </p>
            )}
            {addressSuggestions.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-white p-2 text-sm shadow">
                {addressSuggestions.map((suggestion) => (
                  <li key={`${suggestion.lat}-${suggestion.lng}`}>
                    <button
                      type="button"
                      className="w-full text-left hover:text-primary"
                      onClick={() => applyGeocodingResult(suggestion.label, suggestion.lat, suggestion.lng)}
                    >
                      {suggestion.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Localisation</span>
              <div className="flex items-center gap-2">
                {hasStoredPrefs && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.localStorage.removeItem(STORAGE_KEY);
                      }
                      setForm(defaultCreateFormState);
                      setHasStoredPrefs(false);
                      setAddressQuery('');
                      setAddressSuggestions([]);
                      setGeocodeError(null);
                      setSpotNameEdited(false);
                    }}
                  >
                    Réinitialiser mes préférences
                  </Button>
                )}
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowMap((prev) => !prev)}>
                  {showMap ? 'Masquer la carte' : 'Choisir sur la carte'}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Latitude
                <input
                  type="number"
                  step="any"
                  value={form.spotLat}
                  onChange={(event) => setForm((prev) => ({ ...prev, spotLat: event.target.value }))}
                  className="rounded-md border px-2 py-1"
                  placeholder="43.493"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Longitude
                <input
                  type="number"
                  step="any"
                  value={form.spotLng}
                  onChange={(event) => setForm((prev) => ({ ...prev, spotLng: event.target.value }))}
                  className="rounded-md border px-2 py-1"
                  placeholder="-1.558"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button type="button" size="sm" variant="outline" onClick={handleManualCoordinates}>
                Utiliser ces coordonnées
              </Button>
              <span>Format attendu : latitude 43.493 / longitude -1.558</span>
            </div>
            {showMap && (
              <div className="overflow-hidden rounded-md border">
                <div className="h-64">
                  <LocationPickerMap
                    value={
                      form.spotLat && form.spotLng
                        ? { lat: Number(form.spotLat), lng: Number(form.spotLng) }
                        : null
                    }
                    onChange={({ lat, lng }) => updateCoordinates(lat, lng)}
                    draggableMarker
                  />
                </div>
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Clique sur la carte pour positionner le spot du cours. Les coordonnées sont mises à jour
                  automatiquement.
                </p>
              </div>
            )}
          </div>

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving
                ? (editingAvailability ? 'Modification…' : 'Création…')
                : (editingAvailability ? 'Modifier le créneau' : 'Créer le créneau')}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
