"use client";
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { apiClient } from '../../../lib/apiClient';
import type { GDPRReport, GDPRPurgeResponse } from '../../../lib/apiClient';
import { Shield, AlertTriangle, CheckCircle, Trash2, Search } from 'lucide-react';

type ArchiveResult = Record<string, unknown> | { error: string };

export default function AdminGDPRPage() {
  const [report, setReport] = useState<GDPRReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<GDPRPurgeResponse | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [searchUserId, setSearchUserId] = useState('');
  const [archiveResult, setArchiveResult] = useState<ArchiveResult | null>(null);

  const loadReport = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getGDPRReport();
      setReport(data);
    } catch (error) {
      console.error('Failed to load GDPR report:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, []);

  const handlePurge = async () => {
    if (!confirm('Confirmer la purge RGPD ? Cette action est irréversible.')) return;

    setPurging(true);
    setPurgeError(null);
    try {
      const response = await apiClient.runGDPRPurge();
      setPurgeResult(response);
      await loadReport();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur lors de la purge';
      setPurgeResult(null);
      setPurgeError(message);
    } finally {
      setPurging(false);
    }
  };

  const handleSearchArchive = async () => {
    if (!searchUserId) return;
    try {
      const result = await apiClient.searchLegalArchive(searchUserId);
      setArchiveResult(result);
    } catch (error) {
      setArchiveResult({ error: 'Archive non trouvée' });
    }
  };

  if (loading) return <p>Chargement...</p>;

  const isCompliant = report?.compliance.isCompliant ?? false;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">RGPD & Conformité</h1>
        <Button onClick={loadReport} variant="outline" size="sm">
          Actualiser
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Statut de Conformité
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
          <CardDescription>Détails des contrôles automatiques des données personnelles</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-md p-4">
              <p className="text-sm text-muted-foreground">Sessions expirées</p>
              <p className="text-2xl font-semibold">{report?.details.expiredSessionsCount ?? 0}</p>
            </div>
            <div className="border rounded-md p-4">
              <p className="text-sm text-muted-foreground">Tokens expirés</p>
              <p className="text-2xl font-semibold">{report?.details.expiredTokensCount ?? 0}</p>
            </div>
            <div className="border rounded-md p-4">
              <p className="text-sm text-muted-foreground">Utilisateurs supprimés en attente anonymisation</p>
              <p className="text-2xl font-semibold">{report?.details.unanonymizedDeletedUsers ?? 0}</p>
            </div>
            <div className="border rounded-md p-4">
              <p className="text-sm text-muted-foreground">Utilisateurs à purger (&gt; 7j)</p>
              <p className="text-2xl font-semibold">{report?.details.oldDeletedUsersAwaitingPurge ?? 0}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Recommandations</h2>
            {report?.compliance.recommendations?.length ? (
              <ul className="list-disc list-inside text-sm text-muted-foreground">
                {report.compliance.recommendations.map((rec, idx) => (
                  <li key={idx}>{rec}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune recommandation</p>
            )}
          </div>
        </CardContent>
      </Card>

      {report && report.compliance.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Problèmes détectés ({report.compliance.issues.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {report.compliance.issues.map((issue, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                  <span className="text-sm">{issue}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Purge RGPD</CardTitle>
          <CardDescription>Supprime les sessions expirées, tokens et anonymise les comptes supprimés</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="destructive" onClick={handlePurge} disabled={purging}>
            <Trash2 className="h-4 w-4 mr-2" />
            Lancer la purge
          </Button>
          <p className="text-sm text-muted-foreground">
            Cette action peut prendre plusieurs minutes. Vérifiez l&rsquo;état après exécution.
          </p>
          {purgeError && (
            <p className="text-sm text-red-600">
              {purgeError}
            </p>
          )}
          {purgeResult && !purgeError && (
            <div className="border rounded-md p-4 bg-muted/60 space-y-3 text-sm">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="font-semibold text-green-700">{purgeResult.message}</p>
                <span className="text-xs text-muted-foreground">
                  Exécutée le {new Date(purgeResult.timestamp).toLocaleString('fr-FR')} · {(purgeResult.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <p className="text-muted-foreground">{purgeResult.result.summary}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Technique</p>
                  <ul className="text-xs space-y-1">
                    <li>Sessions supprimées : {purgeResult.result.technicalData.sessionsDeleted}</li>
                    <li>Tokens supprimés : {purgeResult.result.technicalData.tokensDeleted}</li>
                    <li>Logs nettoyés : {purgeResult.result.technicalData.oldLogsDeleted}</li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Anonymisation</p>
                  <ul className="text-xs space-y-1">
                    <li>Phase 1 : {purgeResult.result.userAnonymization.phase1Anonymized}</li>
                    <li>Phase 2 : {purgeResult.result.userAnonymization.phase2Anonymized}</li>
                    <li>Phase 3 : {purgeResult.result.userAnonymization.phase3Purged}</li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Données relationnelles</p>
                  <ul className="text-xs space-y-1">
                    <li>Conversations supprimées : {purgeResult.result.relationalData.conversationsDeleted}</li>
                    <li>Matches supprimés : {purgeResult.result.relationalData.matchesDeleted}</li>
                    <li>Recherches nettoyées : {purgeResult.result.relationalData.oldSearchesDeleted}</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Archives légales</CardTitle>
          <CardDescription>Rechercher l&rsquo;archive d&rsquo;un utilisateur supprimé pour consultation légale</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="User ID"
              value={searchUserId}
              onChange={(e) => setSearchUserId(e.target.value)}
            />
            <Button onClick={handleSearchArchive} variant="outline">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Protection légale</CardTitle>
          <CardDescription>Paramètres d&rsquo;archivage et de rétention de la plateforme</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>Consent archive:</strong> {report?.legalProtection.consentArchiveEnabled ? 'Activée' : 'Désactivée'}
          </p>
          <p>
            <strong>Période de rétention:</strong> {report?.legalProtection.retentionPeriod}
          </p>
          <p>
            <strong>Délai anonymisation:</strong> {report?.legalProtection.anonymizationDelay}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
