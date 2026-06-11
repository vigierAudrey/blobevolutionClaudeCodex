"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient, type AdminBlockedConversation, type AdminSecurityEvent, type AdminSecuritySummary, type SecurityHealth, type SystemAlert } from '../../../lib/apiClient';
import { Users, MessageSquare, ShieldCheck, TrendingUp, AlertTriangle, BarChart3, Lock, Shield, Activity, BookOpen, PenSquare, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

// Force SSR for admin auth and dynamic stats
export const dynamic = 'force-dynamic';

// Interval de polling des alertes et de la santé système (ms)
const POLL_INTERVAL_MS = 60_000;

type AdminUser = {
  email: string;
  role: 'ADMIN' | 'PRO' | 'RIDER';
  [key: string]: unknown;
};

type AdminStats = {
  totalUsers: number;
  totalRiders: number;
  totalPros: number;
  totalAdmins: number;
  totalConversations: number;
  activeUsers: number;
  reportedProfiles: number;
};

const DEFAULT_ADMIN_STATS: AdminStats = {
  totalUsers: 0,
  totalRiders: 0,
  totalPros: 0,
  totalAdmins: 0,
  totalConversations: 0,
  activeUsers: 0,
  reportedProfiles: 0
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Label du lien d'alerte selon le contenu de l'URL
function alertLinkLabel(link: string): string {
  if (/log/i.test(link)) return 'Voir les logs associés →';
  return 'Voir les détails →';
}

export default function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockedConversations, setBlockedConversations] = useState<AdminBlockedConversation[]>([]);
  const [securityEvents, setSecurityEvents] = useState<AdminSecurityEvent[]>([]);
  const [securitySummary, setSecuritySummary] = useState<AdminSecuritySummary | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [systemAlerts, setSystemAlerts] = useState<SystemAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  // F10 — timestamp du dernier refresh réussi des alertes
  const [alertsLastUpdated, setAlertsLastUpdated] = useState<Date | null>(null);
  // F09/F11 — santé système
  const [healthStatus, setHealthStatus] = useState<SecurityHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  // F10 — timestamp du dernier check santé réussi
  const [healthLastUpdated, setHealthLastUpdated] = useState<Date | null>(null);

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const [blockedRes, eventsRes, summaryRes] = await Promise.all([
        apiClient.getBlockedConversations(5),
        apiClient.getSecurityEvents(5),
        apiClient.getSecurityLogsSummary(7),
      ]);
      setBlockedConversations(blockedRes.blocked || []);
      setSecurityEvents(eventsRes.events || []);
      setSecuritySummary(summaryRes ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Impossible de charger les insights sécurité';
      setInsightsError(message);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  // F08 — charge les alertes ; conserve la dernière donnée connue en cas d'erreur
  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const response = await apiClient.getSystemAlerts({ status: 'OPEN', limit: 3 });
      setSystemAlerts(response.items ?? []);
      setAlertsLastUpdated(new Date()); // F10 — uniquement en cas de succès
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Impossible de charger les alertes';
      setAlertsError(message);
      // stale data conservée intentionnellement — pas de setSystemAlerts([])
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  // F09/F11 — charge la santé système ; conserve la dernière donnée connue en cas d'erreur
  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const h = await apiClient.getSecurityHealth();
      setHealthStatus(h);
      setHealthLastUpdated(new Date()); // F10
      setHealthError(null);
    } catch {
      setHealthError('Vérification impossible');
      // stale data conservée intentionnellement
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // No local hint check — truth comes from the server session.
        const currentUser = await apiClient.me();
        if (currentUser.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }

        setUser(currentUser);

        try {
          const adminStats = await apiClient.getAdminStats();
          setStats(adminStats);
        } catch (statsError) {
          console.error('Failed to load admin stats:', statsError);
          setStats({ ...DEFAULT_ADMIN_STATS });
        }

        void loadInsights();
        void loadAlerts();
        void loadHealth(); // F09/F11

      } catch (err: unknown) {
        console.error('Auth check failed:', err);
        const message = err instanceof Error ? err.message : null;
        setError(message || 'Erreur de chargement');
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router, loadInsights, loadAlerts, loadHealth]);

  // F08 — polling alertes toutes les 60s
  useEffect(() => {
    const id = setInterval(() => { void loadAlerts(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id); // cleanup pour éviter les fuites mémoire
  }, [loadAlerts]);

  // F09/F11 — polling santé système toutes les 60s
  useEffect(() => {
    const id = setInterval(() => { void loadHealth(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadHealth]);

  const handleLogout = async () => {
    try {
      await apiClient.logoutAll();
      apiClient.clearTokens();
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
      apiClient.clearTokens();
      router.push('/');
    }
  };

  if (loading) return <p>Chargement…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  const safeStats = stats ?? DEFAULT_ADMIN_STATS;

  // F09 — calcul couleur barre de statut
  const dbOk = healthStatus?.checks.db === 'ok';
  const redisOk = healthStatus?.checks.redis === 'ok';
  const hasHealthData = healthStatus !== null;
  const allOk = dbOk && redisOk;
  const statusBarBg = !hasHealthData
    ? 'bg-slate-50 border-slate-200'
    : allOk
      ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
      : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Administration</h1>
          <p className="text-muted-foreground">
            Bienvenue {user?.email}
          </p>
        </div>
        <Button onClick={handleLogout} variant="outline">
          Déconnexion
        </Button>
      </div>

      {/* F09/F11 — Barre de statut système */}
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 rounded-md border text-sm ${statusBarBg}`}>
        <span className="font-medium text-foreground">État système</span>

        {healthLoading && !hasHealthData && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Vérification…
          </span>
        )}

        {healthError && !hasHealthData && (
          <span className="text-amber-600">{healthError}</span>
        )}

        {hasHealthData && (
          <>
            {/* Base de données */}
            <span className={`flex items-center gap-1 ${dbOk ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
              {dbOk
                ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <XCircle className="h-3.5 w-3.5" />}
              Base de données : {dbOk ? 'OK' : 'Problème'}
            </span>

            {/* Cache serveur (Redis) */}
            <span className={`flex items-center gap-1 ${redisOk ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
              {redisOk
                ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <XCircle className="h-3.5 w-3.5" />}
              Cache serveur : {redisOk ? 'OK' : 'Indisponible'}
            </span>

            {/* F10 — Timestamp dernière vérification */}
            {healthLastUpdated && (
              <span className="text-muted-foreground ml-auto text-xs">
                Vérifié à {formatTime(healthLastUpdated)}
              </span>
            )}

            {/* Lien vers la page détail */}
            <Link href="/admin/health" className="text-xs text-blue-600 underline underline-offset-2">
              Détails →
            </Link>
          </>
        )}
      </div>

      {/* Statistiques principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Utilisateurs totaux</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{safeStats.totalUsers}</div>
            <p className="text-xs text-muted-foreground">
              {safeStats.totalRiders} riders, {safeStats.totalPros} pros, {safeStats.totalAdmins} admins
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{safeStats.totalConversations}</div>
            <p className="text-xs text-muted-foreground">
              Messages échangés
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Utilisateurs actifs</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{safeStats.activeUsers}</div>
            <p className="text-xs text-muted-foreground">
              Derniers 30 jours
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Actions principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 size={20} />
              Analytics
            </CardTitle>
            <CardDescription>
              Visualiser l&rsquo;engagement et les performances de matching
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/analytics">
                  Analytics détaillées
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen size={20} />
              Hub éditorial (Blobosphère)
            </CardTitle>
            <CardDescription>
              Rédiger en MDX, prévisualiser et publier via Git/Decap
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/blobosphere/editor">
                  <PenSquare className="mr-2 h-4 w-4" />
                  Ouvrir l&apos;éditeur interne
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/blobosphere">
                  Décap CMS (iframe)
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={20} />
              Gestion des utilisateurs
            </CardTitle>
            <CardDescription>
              Gérer les comptes utilisateurs, vérifications et suspensions
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/users">
                  Voir tous les utilisateurs
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/users?role=PRO">
                  Gestion des pros
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/reports">
                  Utilisateurs signalés
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare size={20} />
              Modération
            </CardTitle>
            <CardDescription>
              Modérer les conversations et signalements
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/reports">
                  Signalements en attente
                  {safeStats.reportedProfiles > 0 && (
                    <span className="ml-auto bg-red-500 text-white rounded-full px-2 py-1 text-xs">
                      {safeStats.reportedProfiles}
                    </span>
                  )}
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/conversations/blocked">
                  Blocages actifs
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/conversations/broadcast">
                  Diffusion admin
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck size={20} />
              Sécurité
            </CardTitle>
            <CardDescription>
              Sécurité de la plateforme et surveillance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/security">
                  Statut sécurité
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/gdpr">
                  Rétention & exports
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/audit">
                  Audit des actions
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/security/login-attempts">
                  Tentatives de connexion suspectes
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/security/logs">
                  Logs de sécurité
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/permissions">
                  Gestion des permissions
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Insights Sécurité & Modération */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Conversations bloquées
            </CardTitle>
            <CardDescription>Derniers blocages côté messagerie</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {insightsLoading && <p>Chargement...</p>}
            {insightsError && !insightsLoading && (
              <p className="text-sm text-red-600">{insightsError}</p>
            )}
            {!insightsLoading && !blockedConversations.length && !insightsError && (
              <p className="text-sm text-muted-foreground">Aucun blocage récent.</p>
            )}
            {!insightsLoading && blockedConversations.length > 0 && (
              <ul className="space-y-3">
                {blockedConversations.map(item => (
                  <li key={`${item.conversationId}-${item.user.id}`} className="border rounded-md p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{item.user.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.blockedAt ? new Date(item.blockedAt).toLocaleString('fr-FR') : '—'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Conversation {item.conversation?.type || 'N/A'} – {item.conversation?.members?.length ?? 0} membre(s)
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Événements sécurité
            </CardTitle>
            <CardDescription>Actions sensibles sur les 48 dernières heures</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {insightsLoading && <p>Chargement...</p>}
            {!insightsLoading && securityEvents.length === 0 && !insightsError && (
              <p className="text-sm text-muted-foreground">Aucun événement récent.</p>
            )}
            {!insightsLoading && securityEvents.length > 0 && (
              <ul className="space-y-2 text-sm">
                {securityEvents.map(event => (
                  <li key={event.id} className="border rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">{event.action}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {event.user?.email || 'Compte inconnu'} – {event.resource}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {securitySummary && (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-sm mb-1 flex items-center gap-2">
                  <Activity className="h-3 w-3" /> Tendances depuis le {new Date(securitySummary.since).toLocaleDateString('fr-FR')}
                </p>
                <ul className="space-y-1">
                  {securitySummary.items.slice(0, 4).map(item => (
                    <li key={item.action} className="flex justify-between">
                      <span className="font-mono">{item.action}</span>
                      <span>{item.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* F08/F10/F13 — Alertes système avec polling et timestamp */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle size={20} />
              Alertes système
            </CardTitle>
            {/* F10 — timestamp dernière mise à jour */}
            {alertsLastUpdated && (
              <span className="text-xs text-muted-foreground">
                Mis à jour à {formatTime(alertsLastUpdated)}
                {alertsLoading && <Loader2 className="inline ml-1 h-3 w-3 animate-spin" />}
              </span>
            )}
            {alertsLoading && !alertsLastUpdated && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Erreur de refresh : indiquée sans effacer la donnée stale */}
          {alertsError && (
            <p className="text-xs text-amber-600">
              Dernier refresh échoué — données possiblement en retard.
            </p>
          )}
          {!alertsLoading && !alertsError && systemAlerts.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucune alerte pour le moment.</p>
          )}
          {systemAlerts.map((alert) => (
            <div key={alert.id} className="border rounded-md p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{alert.type}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                  alert.severity === 'WARNING'  ? 'bg-yellow-100 text-yellow-800' :
                  'bg-blue-100 text-blue-800'
                }`}>{alert.severity}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{alert.message}</p>
              {/* F13 — lien vers les logs si disponible */}
              {alert.link && (
                <Link
                  href={alert.link}
                  className="inline-block text-xs text-blue-600 underline underline-offset-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  {alertLinkLabel(alert.link)}
                </Link>
              )}
            </div>
          ))}
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href="/admin/alerts">Voir toutes les alertes</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
