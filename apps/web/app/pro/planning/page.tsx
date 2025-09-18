"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
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

type AvailabilityView = BookingAvailability;
interface RequestView extends BookingRequestInboxItem {}

export default function ProPlanningPage() {
  const router = useRouter();
  const [view, setView] = useState<'calendar' | 'list'>('list');
  const [availabilities, setAvailabilities] = useState<AvailabilityView[]>([]);
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionLoadingId, setDecisionLoadingId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
    } catch (err: any) {
      setError(err?.message || 'Erreur de chargement du planning');
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
      .then((u) => {
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
    } catch (err: any) {
      setError(err?.message || 'Impossible de traiter la demande');
    } finally {
      setDecisionLoadingId(null);
    }
  };

  const handleAvailabilityCreated = useCallback(async () => {
    await loadData({ silent: true });
  }, [loadData]);

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
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/pro/planning/${slot.id}`}>Voir les demandes</Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/pro/planning/${slot.id}/edit`}>Modifier</Link>
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
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleAvailabilityCreated}
      />
    </div>
  );
}

interface CreateAvailabilityModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
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

function CreateAvailabilityModal({ open, onClose, onCreated }: CreateAvailabilityModalProps) {
  const [form, setForm] = useState<CreateAvailabilityFormState>(defaultCreateFormState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setForm(defaultCreateFormState);
      setSaving(false);
      setError(null);
    }
  }, [open]);

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
      await apiClient.createBookingAvailability(payload);
      await onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Impossible de créer le créneau');
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
            <h2 className="text-lg font-semibold">Ajouter un créneau</h2>
            <p className="text-sm text-muted-foreground">
              Prépare un créneau (sport, niveaux, horaires et lieu).
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
            Durée (minutes)
            <input
              type="number"
              min={30}
              max={240}
              step={15}
              value={form.duration}
              onChange={(event) =>
                setForm((prev) => {
                  const next = Number(event.target.value);
                  if (Number.isNaN(next)) return prev;
                  const clamped = Math.min(240, Math.max(30, next));
                  return { ...prev, duration: clamped };
                })
              }
              className="rounded-md border px-2 py-1"
              required
            />
            {formattedEnd && (
              <span className="text-xs text-muted-foreground">Fin estimée à {formattedEnd}</span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Nom du spot
            <input
              type="text"
              value={form.spotName}
              onChange={(event) => setForm((prev) => ({ ...prev, spotName: event.target.value }))}
              placeholder="Ex: Plage Centrale"
              className="rounded-md border px-2 py-1"
            />
          </label>

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

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving ? 'Création…' : 'Créer le créneau'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
