"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { apiClient } from '../../../lib/apiClient';
import type {
  GDPRPurgeResponse,
  GDPRReport,
  RetentionExportArtifactSummary,
} from '../../../lib/apiClient';
import { AlertTriangle, CheckCircle, Download, RefreshCcw, Search, Shield, Trash2 } from 'lucide-react';

type ArchiveResult = Record<string, unknown> | { error: string };

function downloadBase64File(fileName: string, mimeType: string, content: string) {
  const decoded = atob(content);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function AdminRetentionPage() {
  const [report, setReport] = useState<GDPRReport | null>(null);
  const [exports, setExports] = useState<RetentionExportArtifactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [purgeResult, setPurgeResult] = useState<GDPRPurgeResponse | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [searchUserId, setSearchUserId] = useState('');
  const [archiveResult, setArchiveResult] = useState<ArchiveResult | null>(null);
  const [fromDate, setFromDate] = useState('2020-01-01T00:00:00.000Z');
  const [toDate, setToDate] = useState(new Date().toISOString());

  const loadPage = async () => {
    setLoading(true);
    try {
      const [reportData, exportsData] = await Promise.all([
        apiClient.getGDPRReport(),
        apiClient.getRetentionExports({ page: 1, limit: 20 }),
      ]);
      setReport(reportData);
      setExports(exportsData.exports ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage();
  }, []);

  const handlePurge = async () => {
    if (!confirm('Confirmer la purge RGPD ? Cette action est irréversible.')) return;
    setPurging(true);
    setPurgeError(null);
    try {
      const response = await apiClient.runGDPRPurge();
      setPurgeResult(response);
      await loadPage();
    } catch (error) {
      setPurgeResult(null);
      setPurgeError(error instanceof Error ? error.message : 'Erreur lors de la purge');
    } finally {
      setPurging(false);
    }
  };

  const handleCreateExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await apiClient.createRetentionExport({
        scope: 'AUDIT_LOG',
        fromDate,
        toDate,
        format: 'NDJSON',
      });
      downloadBase64File(response.download.fileName, response.download.mimeType, response.download.content);
      await loadPage();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Erreur lors de la génération de l’export');
    } finally {
      setExporting(false);
    }
  };

  const handleSearchArchive = async () => {
    if (!searchUserId) return;
    try {
      const result = await apiClient.searchLegalArchive(searchUserId);
      setArchiveResult(result as ArchiveResult);
    } catch {
      setArchiveResult({ error: 'Archive non trouvée' });
    }
  };

  if (loading) {
    return <p>Chargement...</p>;
  }

  const isCompliant = report?.compliance.isCompliant ?? false;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Rétention & exports</h1>
          <p className="text-muted-foreground">
            Pilotage de la rétention, des exports de preuve et de la purge RGPD.
          </p>
        </div>
        <Button onClick={() => loadPage()} variant="outline" size="sm">
          <RefreshCcw className="h-4 w-4 mr-2" />
          Actualiser
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Statut de conformité
            {isCompliant ? (
              <Badge variant="default" className="bg-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                Conforme
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Non conforme
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Contrôles automatiques des données personnelles et de la purge.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-md p-4">
            <p className="text-sm text-muted-foreground">Sessions expirées</p>
            <p className="text-2xl font-semibold">{report?.details.expiredSessionsCount ?? 0}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-sm text-muted-foreground">Tokens expirés</p>
            <p className="text-2xl font-semibold">{report?.details.expiredTokensCount ?? 0}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-sm text-muted-foreground">Comptes supprimés en attente anonymisation</p>
            <p className="text-2xl font-semibold">{report?.details.unanonymizedDeletedUsers ?? 0}</p>
          </div>
          <div className="border rounded-md p-4">
            <p className="text-sm text-muted-foreground">Comptes supprimés à purger (&gt; 10 ans)</p>
            <p className="text-2xl font-semibold">{report?.details.oldDeletedUsersAwaitingPurge ?? 0}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export avant purge
          </CardTitle>
          <CardDescription>
            Génère un export NDJSON des AuditLog et scelle un manifeste VERIFIED avant purge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Début</p>
              <Input value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">Fin</p>
              <Input value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleCreateExport()} disabled={exporting}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? 'Export…' : 'Exporter les AuditLog'}
            </Button>
          </div>
          {exportError && <p className="text-sm text-red-600">{exportError}</p>}
          <div className="space-y-3">
            {exports.map((item) => (
              <div key={item.id} className="border rounded-md p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.scope}</p>
                    <p className="text-muted-foreground">
                      {new Date(item.fromDate).toLocaleString('fr-FR')} → {new Date(item.toDate).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <Badge variant={item.status === 'VERIFIED' ? 'default' : 'secondary'}>
                    {item.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-2">
                  Lignes: {item.rowCount} · SHA-256: {item.sha256 || 'Non calculé'}
                </p>
              </div>
            ))}
            {exports.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun export de rétention généré.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Purge RGPD</CardTitle>
          <CardDescription>
            La purge des AuditLog est bloquée tant qu’aucun manifeste VERIFIED ne couvre la fenêtre purgeable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="destructive" onClick={() => handlePurge()} disabled={purging}>
            <Trash2 className="h-4 w-4 mr-2" />
            {purging ? 'Purge…' : 'Lancer la purge'}
          </Button>
          {purgeError && <p className="text-sm text-red-600">{purgeError}</p>}
          {purgeResult && !purgeError && (
            <div className="border rounded-md p-4 bg-muted/60 space-y-2 text-sm">
              <p className="font-semibold">{purgeResult.message}</p>
              <p className="text-muted-foreground">{purgeResult.result.summary}</p>
              <p className="text-muted-foreground">
                Logs nettoyés: {purgeResult.result.technicalData.oldLogsDeleted}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Archives légales</CardTitle>
          <CardDescription>Recherche d’une archive utilisateur supprimé pour consultation légale.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="User ID"
              value={searchUserId}
              onChange={(e) => setSearchUserId(e.target.value)}
            />
            <Button onClick={() => handleSearchArchive()} variant="outline">
              <Search className="h-4 w-4 mr-2" />
              Rechercher
            </Button>
          </div>

          {archiveResult && (
            <div className="border rounded-md p-4 bg-muted/50">
              <pre className="text-xs whitespace-pre-wrap">
                {JSON.stringify(archiveResult, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
