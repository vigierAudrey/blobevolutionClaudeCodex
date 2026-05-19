"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { apiClient, type ReportHistoryItem } from '../../../lib/apiClient';
import { ArrowLeft, Clock, History, Shield } from 'lucide-react';

type PendingReport = {
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
};

type ReportsResponse = {
  reports: PendingReport[];
  pagination?: { totalPages: number };
  summary?: { pending: number; reviewed: number };
};

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function AdminReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'history' ? 'history' : 'pending';

  const [pendingReports, setPendingReports] = useState<PendingReport[]>([]);
  const [historyItems, setHistoryItems] = useState<ReportHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState({ pending: 0, reviewed: 0 });
  const [search, setSearch] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // No local hint check — truth comes from the server session.
        const currentUser = await apiClient.me();
        if (currentUser.role !== 'ADMIN') {
          router.replace('/dashboard');
        }
      } catch {
        router.replace('/login');
      }
    };

    void checkAuth();
  }, [router]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'history') {
        const response = await apiClient.getAdminReportHistory({ page, limit: 20 });
        setHistoryItems(response.items ?? []);
        setTotalPages(response.pagination?.totalPages ?? 1);
      } else {
        const response = await apiClient.getAdminReports({ page, limit: 20, status: 'pending' }) as ReportsResponse;
        setPendingReports(response.reports ?? []);
        setSummary({
          pending: response.summary?.pending ?? response.reports?.length ?? 0,
          reviewed: response.summary?.reviewed ?? 0,
        });
        setTotalPages(response.pagination?.totalPages ?? 1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de chargement';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, tab]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const filteredPending = useMemo(() => {
    if (!search.trim()) return pendingReports;
    const term = search.trim().toLowerCase();
    return pendingReports.filter((report) =>
      report.reportedProfile.user.email.toLowerCase().includes(term) ||
      report.reporter.email.toLowerCase().includes(term) ||
      (report.reason ?? '').toLowerCase().includes(term),
    );
  }, [pendingReports, search]);

  const filteredHistory = useMemo(() => {
    if (!search.trim()) return historyItems;
    const term = search.trim().toLowerCase();
    return historyItems.filter((item) =>
      item.reportedProfile.user.email.toLowerCase().includes(term) ||
      item.reporter.email.toLowerCase().includes(term) ||
      item.reviewedByAdmin?.email?.toLowerCase().includes(term) ||
      (item.reviewedAction ?? '').toLowerCase().includes(term),
    );
  }, [historyItems, search]);

  const handleAction = async (reportId: string, action: 'approve' | 'dismiss' | 'ban') => {
    const key = `${reportId}:${action}`;
    setActionLoading((current) => ({ ...current, [key]: true }));
    setError(null);
    try {
      await apiClient.moderateReport(reportId, action);
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’exécuter l’action');
    } finally {
      setActionLoading((current) => ({ ...current, [key]: false }));
    }
  };

  const currentItems = tab === 'history' ? filteredHistory : filteredPending;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Signalements</h1>
            <p className="text-muted-foreground">
              File de traitement et historique métier des décisions de modération.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant={tab === 'pending' ? 'default' : 'outline'}
            asChild
          >
            <Link href="/admin/reports">En attente</Link>
          </Button>
          <Button
            variant={tab === 'history' ? 'default' : 'outline'}
            asChild
          >
            <Link href="/admin/reports?tab=history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">En attente</p>
                <p className="text-2xl font-bold">{summary.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm text-muted-foreground">Traités</p>
                <p className="text-2xl font-bold">{summary.reviewed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recherche</CardTitle>
          <CardDescription>
            Filtrer par profil signalé, reporter, admin réviseur ou motif.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Input
            placeholder="Email, action, motif…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="ghost" onClick={() => setSearch('')} disabled={!search}>
            Effacer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'history' ? 'Historique des signalements' : 'Signalements en attente'}</CardTitle>
          <CardDescription>
            {loading ? 'Chargement…' : `${currentItems.length} élément(s) affiché(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && currentItems.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun élément correspondant.</p>
          )}

          {tab === 'pending' && filteredPending.map((report) => (
            <div key={report.id} className="border rounded-md p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{report.reportedProfile.displayName || 'Profil sans nom'}</p>
                  <p className="text-sm text-muted-foreground">{report.reportedProfile.user.email}</p>
                </div>
                <Badge variant="secondary">{formatDate(report.createdAt)}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Reporter: {report.reporter.email} · Motif: {report.reason || 'Non renseigné'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => handleAction(report.id, 'approve')}
                  disabled={actionLoading[`${report.id}:approve`]}
                >
                  Approuver
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction(report.id, 'dismiss')}
                  disabled={actionLoading[`${report.id}:dismiss`]}
                >
                  Rejeter
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleAction(report.id, 'ban')}
                  disabled={actionLoading[`${report.id}:ban`]}
                >
                  Bannir
                </Button>
              </div>
            </div>
          ))}

          {tab === 'history' && filteredHistory.map((item) => (
            <div key={item.id} className="border rounded-md p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{item.reportedProfile.displayName || 'Profil sans nom'}</p>
                  <p className="text-sm text-muted-foreground">{item.reportedProfile.user.email}</p>
                </div>
                <Badge variant="secondary">{item.reviewedAt ? formatDate(item.reviewedAt) : 'Non daté'}</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Reporter</p>
                  <p>{item.reporter.email}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Décision</p>
                  <p className="capitalize">{item.reviewedAction || 'Inconnue'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Admin</p>
                  <p>{item.reviewedByAdmin?.email || item.reviewedByAdminId || 'Compte inconnu'}</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-4">
        <Button
          variant="outline"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1 || loading}
        >
          Précédent
        </Button>
        <p className="text-sm text-muted-foreground">
          Page {page} / {totalPages}
        </p>
        <Button
          variant="outline"
          onClick={() => setPage((current) => (current < totalPages ? current + 1 : current))}
          disabled={page >= totalPages || loading}
        >
          Suivant
        </Button>
      </div>
    </div>
  );
}
