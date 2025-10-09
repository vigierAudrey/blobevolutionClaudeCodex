"use client";

// Force SSR for admin auth and dynamic data
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { apiClient } from '../../../lib/apiClient';
import { ArrowLeft, AlertTriangle, User, Briefcase, Shield, Clock } from 'lucide-react';
import Link from 'next/link';

interface ProfileReport {
  id: string;
  reason?: string;
  createdAt: string;
  reporter: {
    email: string;
    role: string;
  };
  reportedProfile: {
    id: string;
    displayName: string;
    user: {
      id: string;
      email: string;
      role: string;
    };
  };
}

const getRoleIcon = (role: string) => {
  switch (role) {
    case 'PRO': return <Briefcase className="h-4 w-4" />;
    default: return <User className="h-4 w-4" />;
  }
};

const getRoleBadge = (role: string) => {
  switch (role) {
    case 'PRO': return <Badge variant="secondary">Pro</Badge>;
    default: return <Badge variant="outline">Rider</Badge>;
  }
};

export default function AdminReports() {
  const router = useRouter();
  const [reports, setReports] = useState<ProfileReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});

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
      } catch (err) {
        console.error('Auth check failed:', err);
        router.replace('/login');
      }
    };

    checkAuth();
  }, [router]);

  const loadReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getAdminReports({ page, limit: 20 });
      setReports(response.reports || []);
      setTotalPages(response.pagination?.totalPages || 1);
    } catch (err: any) {
      setError(err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [page]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return 'Moins d\'1h';
    if (diffInHours < 24) return `${diffInHours}h`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}j`;

    return formatDate(dateString);
  };

  const handleAction = async (reportId: string, action: 'approve' | 'dismiss' | 'ban') => {
    const actionKey = `${action}-${reportId}`;
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));

    try {
      await apiClient.moderateReport(reportId, action);
      setReports(prev => prev.filter(report => report.id !== reportId));
    } catch (err: any) {
      setError(err?.message || "Impossible d'exécuter l'action");
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  if (loading && reports.length === 0) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <p>Chargement des signalements...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Modération des signalements</h1>
            <p className="text-muted-foreground">
              Gestion des signalements de profils utilisateurs
            </p>
          </div>
        </div>
      </div>

      {/* Statistiques rapides */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{reports.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center">
              <Clock className="h-5 w-5 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-muted-foreground">En attente</p>
                <p className="text-2xl font-bold">{reports.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center">
              <Shield className="h-5 w-5 text-green-500" />
              <div className="ml-3">
                <p className="text-sm font-medium text-muted-foreground">Traités</p>
                <p className="text-2xl font-bold">0</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Erreurs */}
      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Liste des signalements */}
      <Card>
        <CardHeader>
          <CardTitle>Signalements</CardTitle>
          <CardDescription>
            {reports.length} signalement{reports.length > 1 ? 's' : ''} trouvé{reports.length > 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {reports.map((report) => (
              <div key={report.id} className="border rounded-lg p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-4">
                    {/* Header du signalement */}
                    <div className="flex items-center gap-4">
                      <AlertTriangle className="h-5 w-5 text-orange-500" />
                      <div>
                        <h3 className="font-semibold">Signalement de profil</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatTimeAgo(report.createdAt)}
                        </p>
                      </div>
                      <Badge variant="outline" className="ml-auto">
                        En attente
                      </Badge>
                    </div>

                    {/* Profil signalé */}
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        {getRoleIcon(report.reportedProfile.user.role)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {report.reportedProfile.displayName}
                            </span>
                            {getRoleBadge(report.reportedProfile.user.role)}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {report.reportedProfile.user.email}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Détails du signalement */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Signalé par:</span>
                        <span className="text-sm">{report.reporter.email}</span>
                        {getRoleBadge(report.reporter.role)}
                      </div>

                      {report.reason && (
                        <div className="space-y-1">
                          <span className="text-sm font-medium">Motif:</span>
                          <p className="text-sm text-muted-foreground bg-gray-50 p-3 rounded">
                            {report.reason}
                          </p>
                        </div>
                      )}

                      {!report.reason && (
                        <p className="text-sm text-muted-foreground italic">
                          Aucun motif spécifié
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="ml-6 flex flex-col gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleAction(report.id, 'ban')}
                      disabled={actionLoading[`ban-${report.id}`]}
                    >
                      {actionLoading[`ban-${report.id}`] ? '...' : 'Bannir utilisateur'}
                    </Button>

                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleAction(report.id, 'approve')}
                      disabled={actionLoading[`approve-${report.id}`]}
                    >
                      {actionLoading[`approve-${report.id}`] ? '...' : 'Approuver signalement'}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction(report.id, 'dismiss')}
                      disabled={actionLoading[`dismiss-${report.id}`]}
                    >
                      {actionLoading[`dismiss-${report.id}`] ? '...' : 'Rejeter signalement'}
                    </Button>

                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/users/${report.reportedProfile.user.id}`}>
                        Voir profil
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {reports.length === 0 && !loading && (
              <div className="text-center py-12">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Aucun signalement</h3>
                <p className="text-muted-foreground">
                  Aucun signalement en attente de modération
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Précédent
              </Button>
              <span className="flex items-center px-4 text-sm">
                Page {page} sur {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Suivant
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
