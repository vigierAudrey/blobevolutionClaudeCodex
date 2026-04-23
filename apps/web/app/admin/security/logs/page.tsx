"use client";
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Badge, type BadgeProps } from '../../../../components/ui/badge';
import { apiClient, type AdminSecurityEvent } from '../../../../lib/apiClient';
import { Shield, RefreshCw, Download, Filter, ArrowLeft, Activity, AlertTriangle, Clock } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SecurityLogsResponse {
  events: AdminSecurityEvent[];
}

interface FilterOptions {
  action: string;
  limit: number;
}

const ACTION_CATEGORIES = {
  'security:': 'Sécurité système',
  'admin:gdpr:': 'RGPD',
  'admin:allowed-ips': 'Whitelist IP',
  'admin:user:': 'Gestion utilisateurs',
  'admin:report:': 'Modération',
  'admin:permissions:': 'Permissions',
  'admin:role:': 'Rôles'
};

const getActionCategory = (action: string): string => {
  for (const [prefix, label] of Object.entries(ACTION_CATEGORIES)) {
    if (action.startsWith(prefix)) {
      return label;
    }
  }
  return 'Autre';
};

const getSeverityColor = (action: string): NonNullable<BadgeProps['variant']> => {
  if (action.includes('delete') || action.includes('purge') || action.includes('suspend')) {
    return 'destructive';
  }
  if (action.includes('gdpr') || action.includes('allowed-ips') || action.includes('permissions')) {
    return 'default';
  }
  return 'secondary';
};

export default function AdminSecurityLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<AdminSecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterOptions>({
    action: '',
    limit: 100
  });
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getSecurityEvents(filters.limit) as SecurityLogsResponse;
      let filteredEvents = response.events || [];

      if (filters.action) {
        filteredEvents = filteredEvents.filter(event =>
          event.action.toLowerCase().includes(filters.action.toLowerCase())
        );
      }

      setLogs(filteredEvents);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des logs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // No local hint check — truth comes from the server session.
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

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadLogs();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, loadLogs]);

  const exportCSV = () => {
    if (logs.length === 0) return;

    const header = ['Date', 'Action', 'Catégorie', 'Utilisateur', 'Email', 'Ressource', 'IP'];
    const rows = logs.map(log => [
      new Date(log.createdAt).toISOString(),
      log.action,
      getActionCategory(log.action),
      log.user?.id || 'N/A',
      log.user?.email || 'N/A',
      log.resource || 'N/A',
      log.ip || 'N/A'
    ]);

    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security-logs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupedByCategory = logs.reduce((acc, log) => {
    const category = getActionCategory(log.action);
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(log);
    return acc;
  }, {} as Record<string, AdminSecurityEvent[]>);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/security">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Logs de sécurité</h1>
            <p className="text-muted-foreground">
              Suivi en temps réel des actions critiques de sécurité
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Activity className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={logs.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-4 w-4" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtres
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              placeholder="Filtrer par action..."
              value={filters.action}
              onChange={(e) => setFilters(prev => ({ ...prev, action: e.target.value }))}
            />
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Limite:</label>
              <select
                className="border rounded-md px-3 py-2"
                value={filters.limit}
                onChange={(e) => setFilters(prev => ({ ...prev, limit: parseInt(e.target.value) }))}
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </div>
            <Button onClick={loadLogs} disabled={loading}>
              Appliquer
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Événements de sécurité ({logs.length})
            </div>
            {autoRefresh && (
              <Badge variant="default" className="animate-pulse">
                <Clock className="h-3 w-3 mr-1" />
                Live
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Actions sensibles et critiques pour la sécurité de la plateforme
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chargement des logs...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun log trouvé pour ces critères.</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedByCategory).map(([category, categoryLogs]) => (
                <div key={category} className="space-y-3">
                  <div className="flex items-center gap-2 border-b pb-2">
                    <h3 className="font-semibold text-lg">{category}</h3>
                    <Badge variant="outline">{categoryLogs.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {categoryLogs.map((log) => (
                      <div
                        key={log.id}
                        className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <Badge variant={getSeverityColor(log.action)}>
                                {log.action}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(log.createdAt).toLocaleString('fr-FR')}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                              <div>
                                <span className="font-medium">Utilisateur: </span>
                                <span className="text-muted-foreground">
                                  {log.user?.email || 'Système'}
                                </span>
                              </div>
                              <div>
                                <span className="font-medium">Ressource: </span>
                                <span className="text-muted-foreground font-mono text-xs">
                                  {log.resource}
                                </span>
                              </div>
                              {log.ip && (
                                <div>
                                  <span className="font-medium">IP: </span>
                                  <span className="text-muted-foreground font-mono text-xs">
                                    {log.ip}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Statistiques
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-3xl font-bold">{logs.length}</div>
              <div className="text-sm text-muted-foreground">Total événements</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{Object.keys(groupedByCategory).length}</div>
              <div className="text-sm text-muted-foreground">Catégories</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">
                {new Set(logs.map(l => l.user?.email).filter(Boolean)).size}
              </div>
              <div className="text-sm text-muted-foreground">Utilisateurs uniques</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">
                {logs.filter(l => l.action.includes('delete') || l.action.includes('suspend')).length}
              </div>
              <div className="text-sm text-muted-foreground">Actions critiques</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
