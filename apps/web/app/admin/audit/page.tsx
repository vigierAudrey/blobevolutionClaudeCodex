"use client";
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { apiClient, type AuditLogEntry, type AuditLogResponse } from '../../../lib/apiClient';
import { AlertTriangle, Download, Filter, History, RefreshCw, Shield } from 'lucide-react';

interface Filters {
  action: string;
  userId: string;
  resource: string;
  startDate: string;
  endDate: string;
}

const DEFAULT_FILTERS: Filters = {
  action: '',
  userId: '',
  resource: '',
  startDate: '',
  endDate: '',
};

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);

  const fetchLogs = async (nextPage = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page: nextPage,
        limit: 20,
      };
      if (filters.action) params.action = filters.action;
      if (filters.userId) params.userId = filters.userId;
      if (filters.resource) params.resource = filters.resource;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;

      const data = await apiClient.getAuditLogs(params);
      setLogs(data);
      setPage(nextPage);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (field: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const applyFilters = () => {
    fetchLogs(1);
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    fetchLogs(1);
  };

  const exportCSV = () => {
    if (!logs) return;
    const header = ['Date', 'Action', 'Utilisateur', 'Ressource', 'IP'];
    const rows = logs.items.map((item) => [
      new Date(item.createdAt).toISOString(),
      item.action,
      item.user?.email || 'N/A',
      item.resource,
      item.ip || '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const groupedByDay = useMemo(() => {
    if (!logs) return [] as Array<{ day: string; entries: AuditLogEntry[] }>;
    const groups = new Map<string, AuditLogEntry[]>();
    for (const entry of logs.items) {
      const day = new Date(entry.createdAt).toLocaleDateString();
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(entry);
    }
    return Array.from(groups.entries()).map(([day, entries]) => ({ day, entries }));
  }, [logs]);

  const pagination = logs?.pagination;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Audit des Actions</h1>
          <p className="text-sm text-muted-foreground">Suivi des opérations sensibles effectuées par les administrateurs</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV} disabled={!logs?.items.length}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => fetchLogs(page)} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" /> Actualiser
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" /> Filtres
          </CardTitle>
          <CardDescription>Affiner les résultats par action, utilisateur, ressource ou période</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Input
              placeholder="Action"
              value={filters.action}
              onChange={(e) => handleFilterChange('action', e.target.value)}
            />
            <Input
              placeholder="User ID"
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
            />
            <Input
              placeholder="Ressource"
              value={filters.resource}
              onChange={(e) => handleFilterChange('resource', e.target.value)}
            />
            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange('startDate', e.target.value)}
            />
            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange('endDate', e.target.value)}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={applyFilters} disabled={loading}>Appliquer</Button>
            <Button variant="outline" onClick={resetFilters} disabled={loading}>Réinitialiser</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Journal des actions ({logs?.pagination.total ?? 0})
          </CardTitle>
          <CardDescription>Liste des opérations administrateurs avec contexte</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p>Chargement des logs...</p>}
          {!loading && logs && logs.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun log trouvé pour ces filtres.</p>
          )}
          {!loading && logs && logs.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Utilisateur</th>
                    <th className="py-2 pr-4">Ressource</th>
                    <th className="py-2 pr-4">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="py-2 pr-4 whitespace-nowrap">{new Date(item.createdAt).toLocaleString()}</td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary" className="uppercase tracking-wide">
                          {item.action}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-col">
                          <span>{item.user?.email ?? 'N/A'}</span>
                          {item.user?.role && <span className="text-xs text-muted-foreground">{item.user.role}</span>}
                        </div>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{item.resource}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{item.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination && (
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-sm text-muted-foreground">
                Page {pagination.page} / {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchLogs(Math.max(1, page - 1))}
                  disabled={loading || page <= 1}
                >
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchLogs(page + 1)}
                  disabled={loading || (pagination.totalPages && page >= pagination.totalPages)}
                >
                  Suivant
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Timeline des actions
          </CardTitle>
          <CardDescription>Regroupe les actions sensibles par jour</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {groupedByDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune donnée à afficher.</p>
          ) : (
            groupedByDay.map(({ day, entries }) => (
              <div key={day} className="border-l pl-4 border-border space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{day}</Badge>
                  <span className="text-xs text-muted-foreground">{entries.length} actions</span>
                </div>
                <ul className="space-y-1">
                  {entries.slice(0, 5).map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <span className="font-medium">{entry.action}</span> – {entry.resource}
                    </li>
                  ))}
                  {entries.length > 5 && (
                    <li className="text-xs text-muted-foreground">… {entries.length - 5} autres actions</li>
                  )}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> Notes importantes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Les logs sont conservés pour audit interne et conformité RGPD.</p>
          <p>Un export régulier est recommandé pour archivage hors-ligne.</p>
        </CardContent>
      </Card>
    </div>
  );
}
