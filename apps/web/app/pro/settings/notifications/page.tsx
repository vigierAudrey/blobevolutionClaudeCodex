"use client";

export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../../../components/BackBar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Bell } from 'lucide-react';
import { apiRequest } from '../../../../lib/csrf';
import { useToast } from '../../../../components/ui/toast';
import { Spinner } from '../../../../components/ui/spinner';
import { requireClientRole, RoleMismatchError, SessionRequiredError } from '../../../../lib/clientSession';

// D1-FIX: type restreint aux seules clés booléennes affichées dans l'UI.
// emailDigestFrequency (string) et emailEnabled sont intentionnellement exclus
// — ils n'ont pas de contrôle dans cette page et ne doivent pas être toggleables.
type BooleanNotifKey =
  | 'pushEnabled'
  | 'notifyLessonRequests'
  | 'notifyProMessages'
  | 'notifyForSurf'
  | 'notifyForKitesurf';

type NotifPrefs = Record<BooleanNotifKey, boolean>;

const DEFAULT_PREFS: NotifPrefs = {
  pushEnabled: true,
  notifyLessonRequests: true,
  notifyProMessages: true,
  notifyForSurf: true,
  notifyForKitesurf: true,
};

// D2-FIX: valide et extrait uniquement les clés booléennes connues depuis la
// réponse API. Exclut les champs fantômes (notifyBookingAccepted/Rejected,
// emailEnabled, emailDigestFrequency) qui ne sont pas gérés par cette page.
function parseApiPrefs(raw: unknown): Partial<NotifPrefs> {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const result: Partial<NotifPrefs> = {};
  const keys: BooleanNotifKey[] = [
    'pushEnabled',
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
        <div className="text-center py-8">
          <p className="text-muted-foreground">Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      <BackBar fallbackHref="/pro/dashboard" />

      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/20 dark:to-blue-900/20 p-4 border-2 border-purple-200/50 dark:border-purple-800/50">
        <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 text-white shadow-md">
          <Bell className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Notifications</h1>
          <p className="text-sm text-muted-foreground">Choisis quelles alertes tu veux recevoir</p>
        </div>
      </div>

      <Card className="border-2 rounded-[1.75rem]">
        <CardHeader className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30">
          <CardTitle className="text-base text-foreground">Préférences de Notification</CardTitle>
          <CardDescription>Les notifications sont activées par défaut — désactive celles dont tu n&apos;as pas besoin.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {loadingPrefs ? (
            <div className="rounded-xl border-2 border-dashed p-4 text-sm text-muted-foreground">
              Chargement des préférences…
            </div>
          ) : loadError ? (
            // D3-FIX: erreur explicite — l'user sait que les prefs ne sont pas chargées
            <div
              className="rounded-xl border-2 border-red-200 dark:border-red-800/50 bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 p-4"
              role="alert"
            >
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                ❌ Impossible de charger tes préférences : {loadError}
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                Tes préférences actuelles n&apos;ont pas été modifiées.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Push Notifications Master Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border-2 border-purple-200/50 dark:border-purple-800/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 text-white">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">Notifications Push</h4>
                    <p className="text-xs text-muted-foreground">Reçois des alertes instantanées</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggle('pushEnabled')}
                  className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                    notifPrefs.pushEnabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                  aria-label="Toggle push notifications"
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                      notifPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* PRO-specific preferences */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Activité professionnelle</h4>

                <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-amber-300 dark:hover:border-amber-700 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🗺️</span>
                    <div>
                      <p className="text-sm font-medium">Demandes de cours (BloboMap)</p>
                      <p className="text-xs text-muted-foreground">Riders cherchant un cours</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyLessonRequests')}
                    disabled={!notifPrefs.pushEnabled}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      notifPrefs.notifyLessonRequests && notifPrefs.pushEnabled
                        ? 'bg-amber-600'
                        : 'bg-gray-300 dark:bg-gray-600'
                    } ${!notifPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Toggle lesson request notifications"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        notifPrefs.notifyLessonRequests && notifPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💬</span>
                    <div>
                      <p className="text-sm font-medium">Messages</p>
                      <p className="text-xs text-muted-foreground">Messages des riders</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyProMessages')}
                    disabled={!notifPrefs.pushEnabled}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      notifPrefs.notifyProMessages && notifPrefs.pushEnabled
                        ? 'bg-blue-600'
                        : 'bg-gray-300 dark:bg-gray-600'
                    } ${!notifPrefs.pushEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Toggle message notifications"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        notifPrefs.notifyProMessages && notifPrefs.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Sport filters */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filtres par sport</h4>

                <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🏄</span>
                    <div>
                      <p className="text-sm font-medium">Demandes Surf</p>
                      <p className="text-xs text-muted-foreground">Cours de surf uniquement</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyForSurf')}
                    disabled={!notifPrefs.pushEnabled || !notifPrefs.notifyLessonRequests}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      notifPrefs.notifyForSurf && notifPrefs.pushEnabled && notifPrefs.notifyLessonRequests
                        ? 'bg-blue-600'
                        : 'bg-gray-300 dark:bg-gray-600'
                    } ${!notifPrefs.pushEnabled || !notifPrefs.notifyLessonRequests ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Toggle surf notifications"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        notifPrefs.notifyForSurf && notifPrefs.pushEnabled && notifPrefs.notifyLessonRequests ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border-2 hover:border-cyan-300 dark:hover:border-cyan-700 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🪁</span>
                    <div>
                      <p className="text-sm font-medium">Demandes Kitesurf</p>
                      <p className="text-xs text-muted-foreground">Cours de kitesurf uniquement</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle('notifyForKitesurf')}
                    disabled={!notifPrefs.pushEnabled || !notifPrefs.notifyLessonRequests}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      notifPrefs.notifyForKitesurf && notifPrefs.pushEnabled && notifPrefs.notifyLessonRequests
                        ? 'bg-cyan-600'
                        : 'bg-gray-300 dark:bg-gray-600'
                    } ${!notifPrefs.pushEnabled || !notifPrefs.notifyLessonRequests ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label="Toggle kitesurf notifications"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        notifPrefs.notifyForKitesurf && notifPrefs.pushEnabled && notifPrefs.notifyLessonRequests ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Info box when push disabled */}
              {!notifPrefs.pushEnabled && (
                <div className="rounded-lg border-2 border-amber-200 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">ℹ️</span>
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">Notifications désactivées</p>
                      <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
                        Active les notifications push pour recevoir des alertes en temps réel.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Button
                type="button"
                variant="outline"
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
                  '💾 Sauvegarder mes préférences'
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
