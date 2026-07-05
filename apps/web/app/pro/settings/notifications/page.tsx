"use client";

export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../../../components/BackBar';
import { MapPin, MessageSquare, Waves, Wind } from 'lucide-react';
import { apiRequest } from '../../../../lib/csrf';
import { useToast } from '../../../../components/ui/toast';
import { Spinner } from '../../../../components/ui/spinner';
import { requireClientRole, RoleMismatchError, SessionRequiredError } from '../../../../lib/clientSession';
import { BlobAlert, BlobBadge, BlobButton, BlobCard, BlobMark } from '@/components/blob';

// D1-FIX: type restreint aux seules clés booléennes affichées dans l'UI.
// emailDigestFrequency (string) et emailEnabled sont intentionnellement exclus
// — ils n'ont pas de contrôle dans cette page et ne doivent pas être toggleables.
// Cette page ne pilote QUE les préférences par événement (notify*). Ces toggles
// gatent désormais réellement les canaux in-app ET push (cf.
// notification-preferences.service.ts côté API). Les interrupteurs de canal
// (inAppEnabled / pushEnabled) sont gérés sur la page profil pro.
type BooleanNotifKey =
  | 'notifyLessonRequests'
  | 'notifyProMessages'
  | 'notifyForSurf'
  | 'notifyForKitesurf';

type NotifPrefs = Record<BooleanNotifKey, boolean>;

const DEFAULT_PREFS: NotifPrefs = {
  notifyLessonRequests: true,
  notifyProMessages: true,
  notifyForSurf: true,
  notifyForKitesurf: true,
};

const toggleTrackClass = (checked: boolean, disabled = false) =>
  [
    'relative inline-flex h-7 w-12 shrink-0 items-center rounded-sm border-2 transition-colors',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blob-yellow focus-visible:ring-offset-2',
    checked ? 'border-blob-black bg-blob-yellow' : 'border-blob-black/30 bg-white dark:border-white/25 dark:bg-white/10',
    disabled ? 'cursor-not-allowed opacity-50' : '',
  ].join(' ');

const toggleThumbClass = (checked: boolean) =>
  [
    'inline-block h-5 w-5 transform rounded-sm border-2 border-blob-black bg-blob-black transition-transform',
    checked ? 'translate-x-5' : 'translate-x-1',
  ].join(' ');

// D2-FIX: valide et extrait uniquement les clés booléennes connues depuis la
// réponse API. Exclut les champs non gérés par cette page : les masters de canal
// (inAppEnabled / pushEnabled, gérés sur le profil pro), notifyBookingAccepted/
// Rejected (événements non encore émis), emailEnabled, emailDigestFrequency.
function parseApiPrefs(raw: unknown): Partial<NotifPrefs> {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const result: Partial<NotifPrefs> = {};
  const keys: BooleanNotifKey[] = [
    'notifyLessonRequests',
    'notifyProMessages',
    'notifyForSurf',
    'notifyForKitesurf',
  ];
  for (const k of keys) {
    if (typeof src[k] === 'boolean') {
      result[k] = src[k] as boolean;
    }
  }
  return result;
}

export default function ProNotificationsPage() {
  const router = useRouter();
  const toast = useToast();

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  // D3-FIX: état d'erreur explicite pour les échecs de chargement
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        await requireClientRole('PRO');
        if (!active) return;
        setAuthorized(true);
      } catch (e) {
        if (!active) return;
        if (e instanceof RoleMismatchError) {
          router.replace('/dashboard');
          return;
        }
        if (e instanceof SessionRequiredError) {
          router.replace('/login');
          return;
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void bootstrap();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    let active = true;
    const load = async () => {
      try {
        const res = await apiRequest('/profile/notifications', { method: 'GET' });
        // D3-FIX: on expose l'erreur plutôt que de retourner silencieusement
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = (body as { error?: string }).error ?? `Erreur ${res.status}`;
          if (active) setLoadError(msg);
          return;
        }
        const data = await res.json() as { preferences?: unknown };
        if (active) {
          // D2-FIX: merge validé — seules les clés booléennes connues sont acceptées
          setNotifPrefs((prev) => ({ ...prev, ...parseApiPrefs(data.preferences) }));
        }
      } catch {
        if (active) setLoadError('Impossible de charger les préférences. Réessaie plus tard.');
      } finally {
        if (active) setLoadingPrefs(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [authorized]);

  // D1-FIX: paramètre typé BooleanNotifKey uniquement — emailDigestFrequency
  // ne peut plus être passé par erreur.
  const toggle = (key: BooleanNotifKey) => {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // D4-FIX: on n'envoie que les champs affichés dans l'UI (NotifPrefs).
      // emailDigestFrequency et emailEnabled ne sont pas dans ce payload.
      const res = await apiRequest('/profile/notifications', {
        method: 'PUT',
        body: JSON.stringify(notifPrefs),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Erreur lors de la sauvegarde');
      }
      toast('Préférences de notification sauvegardées', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erreur lors de la sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto pb-8">
        <BackBar fallbackHref="/pro/dashboard" />
        <BlobAlert title="Chargement">Chargement…</BlobAlert>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      <BlobCard mode="yellowSignal">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
            <BlobMark size={26} decorative />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-black uppercase tracking-widest text-blob-black">Préférences d&apos;alertes</h1>
              <BlobBadge variant="dark">Pro</BlobBadge>
            </div>
            <p className="mt-2 text-sm leading-6 text-blob-black/72">Choisis les alertes que tu veux recevoir dans Blob et par email.</p>
          </div>
        </div>
      </BlobCard>

      <BlobCard mode="white" className="motion-safe:hover:translate-y-0">
        <div className="border-b-2 border-blob-sand-deep bg-blob-sand px-5 py-4 dark:border-white/10 dark:bg-white/5">
          <h2 className="text-base font-black uppercase tracking-widest text-blob-black dark:text-white">Alertes email et dans Blob</h2>
          <p className="mt-1 text-sm leading-6 text-blob-black/64 dark:text-white/60">
            Les alertes sont activées par défaut. Désactive celles dont tu n&apos;as pas besoin.
          </p>
        </div>
        <div className="p-5">
          {loadingPrefs ? (
            <div className="rounded-sm border-2 border-dashed border-blob-sand-deep p-4 text-sm text-blob-black/64 dark:border-white/10 dark:text-white/60">
              Chargement des préférences…
            </div>
          ) : loadError ? (
            // D3-FIX: erreur explicite — l'user sait que les prefs ne sont pas chargées
            <BlobAlert variant="error" title="Impossible de charger tes préférences">
              <p>{loadError}</p>
              <p className="mt-1 text-xs">
                Tes préférences actuelles n&apos;ont pas été modifiées.
              </p>
            </BlobAlert>
          ) : (
            <div className="space-y-4">
              {/* PRO-specific preferences */}
              <div className="space-y-2">
                <h3 className="text-xs font-black uppercase tracking-widest text-blob-black/60 dark:text-white/55">Activité professionnelle</h3>

                <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase tracking-wide">Demandes de cours (BloboMap)</p>
                      <p className="text-xs text-blob-black/64 dark:text-white/60">Riders cherchant un cours — alerte dans Blob et par email</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyLessonRequests')}
                    className={toggleTrackClass(notifPrefs.notifyLessonRequests)}
                    aria-label="Toggle lesson request notifications"
                  >
                    <span className={toggleThumbClass(notifPrefs.notifyLessonRequests)} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                      <MessageSquare className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase tracking-wide">Messages</p>
                      <p className="text-xs text-blob-black/64 dark:text-white/60">Messages des riders</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyProMessages')}
                    className={toggleTrackClass(notifPrefs.notifyProMessages)}
                    aria-label="Toggle message notifications"
                  >
                    <span className={toggleThumbClass(notifPrefs.notifyProMessages)} />
                  </button>
                </div>
              </div>

              {/* Sport filters */}
              <div className="space-y-2">
                <h3 className="text-xs font-black uppercase tracking-widest text-blob-black/60 dark:text-white/55">Filtres par sport</h3>

                <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                      <Waves className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase tracking-wide">Demandes Surf</p>
                      <p className="text-xs text-blob-black/64 dark:text-white/60">Cours de surf uniquement</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyForSurf')}
                    disabled={!notifPrefs.notifyLessonRequests}
                    className={toggleTrackClass(notifPrefs.notifyForSurf && notifPrefs.notifyLessonRequests, !notifPrefs.notifyLessonRequests)}
                    aria-label="Toggle surf notifications"
                  >
                    <span className={toggleThumbClass(notifPrefs.notifyForSurf && notifPrefs.notifyLessonRequests)} />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-sm border-2 border-blob-sand-deep bg-blob-sand p-3 transition-colors hover:border-blob-yellow dark:border-white/10 dark:bg-white/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-blob-black bg-blob-yellow text-blob-black">
                      <Wind className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black uppercase tracking-wide">Demandes Kitesurf</p>
                      <p className="text-xs text-blob-black/64 dark:text-white/60">Cours de kitesurf uniquement</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyForKitesurf')}
                    disabled={!notifPrefs.notifyLessonRequests}
                    className={toggleTrackClass(notifPrefs.notifyForKitesurf && notifPrefs.notifyLessonRequests, !notifPrefs.notifyLessonRequests)}
                    aria-label="Toggle kitesurf notifications"
                  >
                    <span className={toggleThumbClass(notifPrefs.notifyForKitesurf && notifPrefs.notifyLessonRequests)} />
                  </button>
                </div>
              </div>

              <BlobButton
                type="button"
                variant="outlineDark"
                size="sm"
                onClick={save}
                disabled={saving}
                className="w-full sm:w-auto"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    Sauvegarde...
                  </span>
                ) : (
                  'Sauvegarder mes préférences'
                )}
              </BlobButton>
            </div>
          )}
        </div>
      </BlobCard>
    </div>
  );
}
