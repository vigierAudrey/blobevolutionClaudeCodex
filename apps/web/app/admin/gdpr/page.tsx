"use client";
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Badge } from '../../../components/ui/badge';
import { apiClient } from '../../../lib/apiClient';
import { Shield, AlertTriangle, CheckCircle, Trash2, Search, Download } from 'lucide-react';

interface GDPRReport {
  timestamp: string;
  compliance: {
    isCompliant: boolean;
    issues: string[];
    recommendations: string[];
  };
  details: {
    expiredSessionsCount: number;
    expiredTokensCount: number;
    unanonymizedDeletedUsers: number;
    oldDeletedUsersAwaitingPurge: number;
  };
  legalProtection: {
    consentArchiveEnabled: boolean;
    retentionPeriod: string;
    anonymizationDelay: string;
  };
}

export default function AdminGDPRPage() {
  const [report, setReport] = useState<GDPRReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [searchUserId, setSearchUserId] = useState('');
  const [archiveResult, setArchiveResult] = useState<any>(null);

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
    try {
      await apiClient.runGDPRPurge();
      alert('Purge RGPD exécutée avec succès');
      loadReport();
    } catch (error) {
      alert('Erreur lors de la purge');
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
            Cette action peut prendre plusieurs minutes. Vérifiez l'état après exécution.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Archives légales</CardTitle>
          <CardDescription>Rechercher l'archive d'un utilisateur supprimé pour consultation légale</CardDescription>
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
          <CardDescription>Paramètres d'archivage et de rétention de la plateforme</CardDescription>
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
