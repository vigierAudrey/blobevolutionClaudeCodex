"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { apiClient } from '../../../lib/apiClient';
import { Users, MessageSquare, ShieldCheck, Settings, TrendingUp, AlertTriangle, BarChart3 } from 'lucide-react';
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

export default function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          // Utiliser des valeurs par défaut si les stats échouent
          setStats({
            totalUsers: 0,
            totalRiders: 0,
            totalPros: 0,
            totalAdmins: 0,
            totalConversations: 0,
            activeUsers: 0,
            reportedProfiles: 0
          });
        }

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
  }, [router]);

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
            <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.totalRiders || 0} riders, {stats?.totalPros || 0} pros, {stats?.totalAdmins || 0} admins
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalConversations || 0}</div>
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
            <div className="text-2xl font-bold">{stats?.activeUsers || 0}</div>
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
                  {stats?.reportedProfiles > 0 && (
                    <span className="ml-auto bg-red-500 text-white rounded-full px-2 py-1 text-xs">
                      {stats.reportedProfiles}
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
                Gestion des crédits
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Maintenance système
              </Button>
            </div>
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
