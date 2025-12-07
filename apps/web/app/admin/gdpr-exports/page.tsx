"use client";

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { apiClient } from '../../../lib/apiClient';
import { useRouter } from 'next/navigation';
import { BackBar } from '../../../components/BackBar';
import { Spinner } from '../../../components/ui/spinner';

interface ExportSummary {
  total: number;
  last24h: number;
  last7days: number;
  last30days: number;
  byRole: Record<string, number>;
  topExporters: Array<{
    userId: string;
    email: string;
    role: string;
    exportCount: number;
  }>;
}

interface ExportRecord {
  id: string;
  userId: string | null;
  userEmail: string;
  userRole: string;
  ip: string;
  exportDate: string;
  dataSize: number;
  dataSizeMB: string;
  itemCounts: Record<string, number>;
}

interface GDPRExportsData {
  exports: ExportRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: ExportSummary;
}

export default function GDPRExportsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<GDPRExportsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterUserId, setFilterUserId] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const loadExports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '50',
      });

      if (filterUserId) queryParams.append('userId', filterUserId);
      if (filterStartDate) queryParams.append('startDate', filterStartDate);
      if (filterEndDate) queryParams.append('endDate', filterEndDate);

      const tokens = apiClient.getTokens();
      if (!tokens?.accessToken) {
        router.push('/login');
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/admin/gdpr/exports?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          router.push('/login');
          return;
        }
        throw new Error('Erreur lors du chargement des exports');
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [filterEndDate, filterStartDate, filterUserId, page, router]);

  useEffect(() => {
    void loadExports();
  }, [loadExports]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('fr-FR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <BackBar fallbackHref="/admin/dashboard" />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">📥 Monitoring Exports GDPR</h1>
          <p className="text-muted-foreground mt-1">
            Surveillance des demandes d&apos;export de données personnelles
          </p>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      {data?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Exports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.summary.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Dernières 24h</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.summary.last24h}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">7 derniers jours</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.summary.last7days}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">30 derniers jours</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.summary.last30days}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Exports by Role & Top Exporters */}
      {data?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Exports par Rôle (30 jours)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(data.summary.byRole).map(([role, count]) => (
                  <div key={role} className="flex justify-between items-center">
                    <span className="font-medium">{role}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top 10 Exporteurs (30 jours)</CardTitle>
              <CardDescription>Utilisateurs avec le plus d&apos;exports</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.summary.topExporters.slice(0, 10).map((exporter) => (
                  <div key={exporter.userId} className="flex justify-between items-center text-sm">
                    <div className="flex-1 truncate">
                      <span className="font-medium">{exporter.email}</span>
                      <span className="text-muted-foreground ml-2">({exporter.role})</span>
                    </div>
                    <span className="text-muted-foreground ml-2">{exporter.exportCount}x</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">User ID</label>
              <input
                type="text"
                value={filterUserId}
                onChange={(e) => setFilterUserId(e.target.value)}
                placeholder="UUID de l'utilisateur"
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date début</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date fin</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exports Table */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des Exports</CardTitle>
          <CardDescription>
            {data?.pagination && `Page ${data.pagination.page} sur ${data.pagination.totalPages} (${data.pagination.total} exports au total)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4">Date</th>
                  <th className="text-left py-3 px-4">Utilisateur</th>
                  <th className="text-left py-3 px-4">Rôle</th>
                  <th className="text-left py-3 px-4">IP</th>
                  <th className="text-right py-3 px-4">Taille</th>
                  <th className="text-left py-3 px-4">Items</th>
                </tr>
              </thead>
              <tbody>
                {data?.exports.map((exp) => (
                  <tr key={exp.id} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-4 text-sm">{formatDate(exp.exportDate)}</td>
                    <td className="py-3 px-4 text-sm">
                      <div className="truncate max-w-xs">{exp.userEmail}</div>
                      <div className="text-xs text-muted-foreground truncate">{exp.userId}</div>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                        {exp.userRole}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{exp.ip}</td>
                    <td className="py-3 px-4 text-sm text-right font-mono">
                      {exp.dataSizeMB} MB
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {Object.keys(exp.itemCounts).length > 0 ? (
                        <details className="cursor-pointer">
                          <summary className="text-blue-600">Voir détails</summary>
                          <div className="mt-2 text-xs space-y-1">
                            {Object.entries(exp.itemCounts).map(([key, value]) => (
                              <div key={key} className="flex justify-between">
                                <span>{key}:</span>
                                <span className="font-mono">{value}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data?.pagination && data.pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
              >
                Précédent
              </button>
              <span className="px-4 py-2">
                Page {page} / {data.pagination.totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))}
                disabled={page >= data.pagination.totalPages}
                className="px-4 py-2 border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
              >
                Suivant
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
