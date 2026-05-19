"use client";
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Badge } from '../../../../components/ui/badge';
import { apiClient, type LoginAttempt, type LoginAttemptsResponse } from '../../../../lib/apiClient';
import { Shield, RefreshCw, Download, Filter, ArrowLeft, AlertTriangle, CheckCircle, XCircle, TrendingUp, Activity, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface FilterOptions {
  onlyFailed: boolean;
  suspiciousOnly: boolean;
  /** Max 100 — enforced server-side. */
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
    limit: 50
  });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [allAttempts, setAllAttempts] = useState<LoginAttemptsResponse['attempts']>([]);

  const loadAttempts = useCallback(async (nextCursor?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.getLoginAttempts({
        limit: filters.limit,
        onlyFailed: filters.onlyFailed,
        suspiciousOnly: filters.suspiciousOnly,
        cursor: nextCursor ?? undefined,
      });
      if (nextCursor) {
        setAllAttempts(prev => [...prev, ...response.attempts]);
      } else {
        setAllAttempts(response.attempts);
      }
      setData(response);
      setCursor(response.nextCursor);
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
    setCursor(null);
    setAllAttempts([]);
    loadAttempts(null);
  }, [loadAttempts]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      setCursor(null);
      setAllAttempts([]);
      loadAttempts(null);
    }, 15000); // Refresh every 15 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, loadAttempts]);

  const exportCSV = () => {
    if (allAttempts.length === 0) return;

    // Pas de colonnes email/IP bruts (toujours null côté API par design RGPD).
    // On exporte uniquement les empreintes pseudonymisées.
    const header = ['Date', 'Empreinte compte', 'Empreinte IP', 'User Agent', 'Succès', 'Raison'];
    const rows = allAttempts.map(attempt => [
      new Date(attempt.createdAt).toISOString(),
      attempt.emailHash ?? '',
      attempt.ipHash ?? '',
      attempt.userAgent ?? '',
      attempt.success ? 'Oui' : 'Non',
      attempt.reason ?? '',
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
    if (attempt.success) return indicators;

    // Regroupement par empreinte IP (ipHash) — ip brut est toujours null (RGPD)
    if (attempt.ipHash) {
      const sameIpHashFailures = allAttempts.filter(
        a => a.ipHash === attempt.ipHash && !a.success
      );
      if (sameIpHashFailures.length >= 3) {
        indicators.push(`${sameIpHashFailures.length} échecs depuis cette empreinte IP`);
      }
    }

    // Regroupement par empreinte compte (emailHash) — email brut est toujours null (RGPD)
    if (attempt.emailHash) {
      const sameEmailHashFailures = allAttempts.filter(
        a => a.emailHash === attempt.emailHash && !a.success
      );
      if (sameEmailHashFailures.length >= 5) {
        indicators.push(`${sameEmailHashFailures.length} échecs sur cette empreinte compte`);
      }
    }

    // Tentatives rapides — basé sur timestamp + emailHash uniquement
    if (attempt.emailHash) {
      const t = new Date(attempt.createdAt).getTime();
      const rapidCount = allAttempts.filter(a =>
        a.emailHash === attempt.emailHash &&
        Math.abs(new Date(a.createdAt).getTime() - t) < 60_000
      ).length;
      if (rapidCount >= 3) {
        indicators.push('Tentatives rapides (brute force possible)');
      }
    }

    return indicators;
  };

  // Regroupement par empreinte IP — "Unknown" uniquement si ipHash absent
  const groupByIpHash = (attempts: LoginAttempt[]) => {
    const map = new Map<string, LoginAttempt[]>();
    attempts.forEach(a => {
      const key = a.ipHash ?? 'inconnu';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  };

  const attempts = allAttempts;
  const groupedByIpHash = groupByIpHash(attempts.filter(a => !a.success));
  const showStats = Boolean(data) && !filters.suspiciousOnly;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link href="/admin" className="hover:text-foreground transition-colors">Administration</Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/admin/security" className="hover:text-foreground transition-colors">Sécurité</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">Tentatives de connexion</span>
          </nav>
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
          <Button variant="outline" size="sm" onClick={() => { setCursor(null); setAllAttempts([]); loadAttempts(null); }} disabled={loading}>
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

      {showStats && data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total tentatives</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.stats.total}</div>
              <p className="text-xs text-muted-foreground">
                Périmètre courant
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

      {filters.suspiciousOnly && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Les statistiques globales sont masquées en mode suspects uniquement pour éviter un périmètre incohérent avec la liste affichée.
            </p>
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
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {filters.suspiciousOnly && groupedByIpHash.filter(([key]) => key !== 'inconnu').length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Empreintes IP suspectes
            </CardTitle>
            <CardDescription>
              Empreintes IP pseudonymisées avec de multiples échecs de connexion. Ces valeurs ne sont pas des adresses IP lisibles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {groupedByIpHash.filter(([key]) => key !== 'inconnu').slice(0, 10).map(([ipHash, ipAttempts]) => (
                <div key={ipHash} className="border rounded-lg p-4 bg-red-50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-xs text-muted-foreground mr-2">Empreinte IP :</span>
                      <span className="font-mono text-sm font-medium">{ipHash.slice(0, 12)}…</span>
                    </div>
                    <Badge variant="destructive">{ipAttempts.length} échecs</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                    <div>
                      Comptes ciblés (empreintes distinctes) : {new Set(ipAttempts.map(a => a.emailHash)).size}
                    </div>
                    <div>
                      Dernière tentative : {new Date(ipAttempts[0].createdAt).toLocaleString('fr-FR')}
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
            Historique des tentatives ({attempts.length}{data?.stats?.total !== undefined && data.stats.total > attempts.length ? ` / ${data.stats.total}` : ''})
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
                          <div className="font-mono text-sm text-muted-foreground">
                            {attempt.emailHash
                              ? <span title="Empreinte compte (pseudonymisée)">Empreinte : {attempt.emailHash.slice(0, 10)}…</span>
                              : <span className="italic">Compte inconnu</span>
                            }
                          </div>
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
                      {attempt.ipHash && (
                        <div>
                          <span className="font-medium">Empreinte IP : </span>
                          <span className="font-mono text-xs" title="Empreinte pseudonymisée — pas une adresse IP lisible">
                            {attempt.ipHash.slice(0, 12)}…
                          </span>
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
          {cursor && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadAttempts(cursor)}
                disabled={loading}
              >
                {loading ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-2" />
                )}
                Charger la suite
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
