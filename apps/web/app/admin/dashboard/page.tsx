"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient, type AdminBlockedConversation, type AdminSecurityEvent, type AdminSecuritySummary } from '../../../lib/apiClient';
import { Users, MessageSquare, ShieldCheck, Settings, TrendingUp, AlertTriangle, BarChart3, Lock, Shield, Activity } from 'lucide-react';
import Link from 'next/link';

// Force SSR for admin auth and dynamic stats
export const dynamic = 'force-dynamic';

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

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const [blockedRes, eventsRes, summaryRes] = await Promise.all([
        apiClient.getBlockedConversations(5),
        apiClient.getSecurityEvents(5),
        apiClient.getSecurityLogsSummary(7)
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

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }

        const currentUser = await apiClient.me();
        if (currentUser.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }

        setUser(currentUser);

        // Charger les statistiques depuis l'API admin
        try {
          const adminStats = await apiClient.getAdminStats();
          setStats(adminStats);
        } catch (statsError) {
          console.error('Failed to load admin stats:', statsError);
          setStats({ ...DEFAULT_ADMIN_STATS });
        }

        void loadInsights();

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
  }, [router, loadInsights]);

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
              <Button variant="outline" className="w-full justify-start" disabled>
                Conversations bloquées
                <span className="ml-auto text-xs text-muted-foreground">Bientôt</span>
              </Button>
              <Button variant="outline" className="w-full justify-start" disabled>
                Historique modération
                <span className="ml-auto text-xs text-muted-foreground">Bientôt</span>
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
                  Conformité RGPD
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/audit">
                  Audit des actions
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" disabled>
                Tentatives de connexion suspectes
                <span className="ml-auto text-xs text-muted-foreground">Bientôt</span>
              </Button>
              <Button variant="outline" className="w-full justify-start" disabled>
                Logs de sécurité
                <span className="ml-auto text-xs text-muted-foreground">Bientôt</span>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href="/admin/permissions">
                  Gestion des permissions
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings size={20} />
              Configuration
            </CardTitle>
            <CardDescription>
              Paramètres de la plateforme et maintenance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start">
                Paramètres généraux
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Monétisation & publicités
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Maintenance système
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

      {/* Alertes et notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle size={20} />
            Alertes système
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Aucune alerte pour le moment. La plateforme fonctionne normalement.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
