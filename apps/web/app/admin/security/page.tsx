"use client";
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { apiClient } from '../../../lib/apiClient';
import { Shield, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

interface SecurityHealth {
  status: 'SECURE' | 'VULNERABLE';
  helmet: boolean;
  csrf: boolean;
  rateLimit: boolean;
  corsWhitelist: string[];
  issues: string[];
}

export default function AdminSecurityPage() {
  const [health, setHealth] = useState<SecurityHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const checkHealth = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getSecurityHealth();
      setHealth(data);
    } catch (error) {
      console.error('Failed to fetch security health:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  if (loading) return <p>Chargement...</p>;

  const isSecure = health?.status === 'SECURE';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sécurité Platform</h1>
        <Button onClick={checkHealth} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Vérifier
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            État de Sécurité
            {isSecure ? (
              <Badge variant="default" className="bg-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                Sécurisé
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Vulnérable
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className={`text-2xl font-bold ${health?.helmet ? 'text-green-600' : 'text-red-600'}`}>
                {health?.helmet ? '✓' : '✗'}
              </div>
              <div className="text-sm text-muted-foreground">Helmet Headers</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${health?.csrf ? 'text-green-600' : 'text-red-600'}`}>
                {health?.csrf ? '✓' : '✗'}
              </div>
              <div className="text-sm text-muted-foreground">CSRF Protection</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${health?.rateLimit ? 'text-green-600' : 'text-red-600'}`}>
                {health?.rateLimit ? '✓' : '✗'}
              </div>
              <div className="text-sm text-muted-foreground">Rate Limiting</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${health?.corsWhitelist.length ? 'text-green-600' : 'text-yellow-600'}`}>
                {health?.corsWhitelist.length || 0}
              </div>
              <div className="text-sm text-muted-foreground">CORS Origins</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {health && health.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Problèmes Détectés ({health.issues.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {health.issues.map((issue, idx) => (
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
          <CardTitle>CORS Origins Autorisées</CardTitle>
          <CardDescription>Domaines autorisés à appeler l'API</CardDescription>
        </CardHeader>
        <CardContent>
          {health?.corsWhitelist.length === 0 ? (
            <p className="text-sm text-yellow-600">⚠️ Aucun domaine configuré (mode développement)</p>
          ) : (
            <ul className="space-y-1">
              {health?.corsWhitelist.map((origin, idx) => (
                <li key={idx} className="text-sm font-mono bg-muted px-2 py-1 rounded">
                  {origin}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
