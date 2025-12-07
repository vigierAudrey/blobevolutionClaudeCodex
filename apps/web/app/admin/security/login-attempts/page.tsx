"use client";
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { apiClient, type LoginAttempt, type LoginAttemptsResponse } from '../../../../lib/apiClient';
import { Shield, RefreshCw, Download, Filter, ArrowLeft, AlertTriangle, CheckCircle, XCircle, TrendingUp, Activity } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface FilterOptions {
  onlyFailed: boolean;
  suspiciousOnly: boolean;
  limit: number;
}

export default function AdminLoginAttemptsPage() {
  const router = useRouter();
  const [data, setData] = useState<LoginAttemptsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterOptions>({
    onlyFailed: false,
    suspiciousOnly: false,
    limit: 100
  });
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadAttempts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getLoginAttempts({
        limit: filters.limit,
        onlyFailed: filters.onlyFailed,
        suspiciousOnly: filters.suspiciousOnly
      });
      setData(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors du chargement des tentatives';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

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

  useEffect(() => {
    loadAttempts();
  }, [loadAttempts]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadAttempts();
    }, 15000); // Refresh every 15 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, loadAttempts]);

  const exportCSV = () => {
    if (!data || data.attempts.length === 0) return;

    const header = ['Date', 'Email', 'IP', 'User Agent', 'Succès', 'Raison', 'User ID'];
    const rows = data.attempts.map(attempt => [
      new Date(attempt.createdAt).toISOString(),
      attempt.email,
      attempt.ip || 'N/A',
      attempt.userAgent || 'N/A',
      attempt.success ? 'Oui' : 'Non',
      attempt.reason || 'N/A',
      attempt.userId || 'N/A'
    ]);

    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `login-attempts-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getSuspiciousIndicators = (attempt: LoginAttempt, allAttempts: LoginAttempt[]) => {
    const indicators: string[] = [];

    if (!attempt.success) {
      // Check for multiple failures from same IP
      const sameIPFailures = allAttempts.filter(
        a => a.ip === attempt.ip && !a.success && a.ip !== null
      );
      if (sameIPFailures.length >= 3) {
        indicators.push(`${sameIPFailures.length} échecs depuis cette IP`);
      }

      // Check for multiple failures for same email
      const sameEmailFailures = allAttempts.filter(
        a => a.email === attempt.email && !a.success
      );
      if (sameEmailFailures.length >= 5) {
        indicators.push(`${sameEmailFailures.length} échecs sur ce compte`);
      }

      // Check for rapid attempts
      const recentAttempts = allAttempts.filter(a => {
        const timeDiff = new Date(attempt.createdAt).getTime() - new Date(a.createdAt).getTime();
        return Math.abs(timeDiff) < 60000 && a.email === attempt.email; // Within 1 minute
      });
      if (recentAttempts.length >= 3) {
        indicators.push('Tentatives rapides (brute force possible)');
      }
    }

    return indicators;
  };

  const groupByIP = (attempts: LoginAttempt[]) => {
    const ipMap = new Map<string, LoginAttempt[]>();
    attempts.forEach(attempt => {
      const ip = attempt.ip || 'Unknown';
      if (!ipMap.has(ip)) {
        ipMap.set(ip, []);
      }
      ipMap.get(ip)!.push(attempt);
    });
    return Array.from(ipMap.entries()).sort((a, b) => b[1].length - a[1].length);
  };

  const attempts = data?.attempts || [];
  const groupedByIP = groupByIP(attempts.filter(a => !a.success));

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
            <h1 className="text-3xl font-bold">Tentatives de connexion</h1>
            <p className="text-muted-foreground">
              Surveillance des connexions et détection des activités suspectes
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
            {autoRefresh ? 'Auto ON' : 'Auto OFF'}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={attempts.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={loadAttempts} disabled={loading}>
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

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total tentatives</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.stats.total}</div>
              <p className="text-xs text-muted-foreground">
                Dernières 24 heures
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Échecs</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{data.stats.failed}</div>
              <p className="text-xs text-muted-foreground">
                Connexions échouées
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Taux de réussite</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{data.stats.successRate}%</div>
              <p className="text-xs text-muted-foreground">
                Connexions réussies
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtres
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.onlyFailed}
                onChange={(e) => setFilters(prev => ({ ...prev, onlyFailed: e.target.checked }))}
              />
              <span className="text-sm">Échecs uniquement</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.suspiciousOnly}
                onChange={(e) => setFilters(prev => ({ ...prev, suspiciousOnly: e.target.checked }))}
              />
              <span className="text-sm">Suspects uniquement</span>
            </label>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Limite:</label>
              <select
                className="border rounded-md px-3 py-1"
                value={filters.limit}
                onChange={(e) => setFilters(prev => ({ ...prev, limit: parseInt(e.target.value) }))}
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {filters.suspiciousOnly && groupedByIP.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              IPs suspectes
            </CardTitle>
            <CardDescription>
              Adresses IP avec de multiples échecs de connexion
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {groupedByIP.slice(0, 10).map(([ip, ipAttempts]) => (
                <div key={ip} className="border rounded-lg p-4 bg-red-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-medium">{ip}</span>
                    <Badge variant="destructive">{ipAttempts.length} échecs</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                    <div>
                      Emails ciblés: {new Set(ipAttempts.map(a => a.email)).size}
                    </div>
                    <div>
                      Dernière tentative: {new Date(ipAttempts[0].createdAt).toLocaleString('fr-FR')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Historique des tentatives ({attempts.length})
          </CardTitle>
          <CardDescription>
            Tentatives de connexion avec indicateurs de sécurité
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chargement...</p>
          ) : attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune tentative trouvée.</p>
          ) : (
            <div className="space-y-3">
              {attempts.map((attempt) => {
                const indicators = getSuspiciousIndicators(attempt, attempts);
                const isSuspicious = indicators.length > 0;

                return (
                  <div
                    key={attempt.id}
                    className={`border rounded-lg p-4 ${
                      isSuspicious ? 'border-red-300 bg-red-50' : 'hover:bg-muted/50'
                    } transition-colors`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {attempt.success ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        <div>
                          <div className="font-medium">{attempt.email}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(attempt.createdAt).toLocaleString('fr-FR')}
                          </div>
                        </div>
                      </div>
                      {attempt.success ? (
                        <Badge variant="default" className="bg-green-500">Réussi</Badge>
                      ) : (
                        <Badge variant="destructive">Échec</Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                      {attempt.ip && (
                        <div>
                          <span className="font-medium">IP: </span>
                          <span className="font-mono text-xs">{attempt.ip}</span>
                        </div>
                      )}
                      {attempt.reason && (
                        <div>
                          <span className="font-medium">Raison: </span>
                          <span className="text-muted-foreground">{attempt.reason}</span>
                        </div>
                      )}
                      {attempt.userAgent && (
                        <div className="col-span-2">
                          <span className="font-medium">User-Agent: </span>
                          <span className="text-xs text-muted-foreground truncate block">
                            {attempt.userAgent}
                          </span>
                        </div>
                      )}
                    </div>

                    {isSuspicious && (
                      <div className="mt-3 pt-3 border-t border-red-200">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-red-700 mb-1">
                              Indicateurs suspects:
                            </div>
                            <ul className="text-sm text-red-600 space-y-1">
                              {indicators.map((indicator, idx) => (
                                <li key={idx}>• {indicator}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
