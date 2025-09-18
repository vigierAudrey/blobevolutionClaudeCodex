"use client";
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import Link from 'next/link';
import { Badge } from '../../../components/ui/badge';
import { User, Map, CreditCard, Percent, Info, LogOut, BookOpen, MessageSquare, Network } from 'lucide-react';

export default function ProDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [planningStats, setPlanningStats] = useState<{ availabilityCount: number; pendingCount: number } | null>(null);

  const loadPlanningStats = useCallback(async () => {
    try {
      const [availabilityRes, inboxRes] = await Promise.all([
        apiClient.getBookingAvailabilitiesForPro(),
        apiClient.getBookingRequestsInbox(),
      ]);
      const pendingCount = inboxRes.requests.filter((req) => req.status === 'PENDING').length;
      setPlanningStats({ availabilityCount: availabilityRes.availabilities.length, pendingCount });
    } catch (_) {
      setPlanningStats({ availabilityCount: 0, pendingCount: 0 });
    }
  }, []);

  useEffect(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    apiClient
      .me()
      .then((u) => {
        // Vérifier que l'utilisateur est bien un PRO
        if (u.role !== 'PRO') {
          router.replace('/dashboard');
          return;
        }
        setUser(u);
        void loadPlanningStats();
      })
      .catch(() => {
        router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [loadPlanningStats, router]);

  const logout = async () => {
    try {
      await apiClient.logoutAll();
    } catch (_) {}
    apiClient.clearTokens();
    router.replace('/login');
  };

  if (loading) return <p>Chargement…</p>;
  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard Professionnel</h1>
          <p className="text-sm text-muted-foreground">Bienvenue, {user?.email}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/account" className="text-sm underline text-primary">Mon compte</Link>
          <Button variant="destructive" onClick={logout} className="inline-flex items-center gap-2">
            <LogOut size={16}/> Déconnexion
          </Button>
        </div>
      </div>

      {!user?.emailVerified && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Ton email n'est pas encore vérifié. Pense à confirmer ton adresse pour sécuriser ton compte.
          <div className="mt-2">
            <Link className="underline" href="/account">Voir mon compte</Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User size={18}/> Profil pro</CardTitle>
            <CardDescription>Renseigne tes infos (nom, bio, tarif, logo)</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/pro/profile" className="inline-block w-full">
              <Button className="w-full">Ouvrir mon profil pro</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Map size={18}/> BloboMap</CardTitle>
            <CardDescription>Voir les demandes de cours autour de toi</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/pro/map" className="inline-block w-full">
              <Button className="w-full" variant="secondary">Ouvrir la BloboMap</Button>
            </Link>
          </CardContent>
        </Card>


        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageSquare size={18}/> Messages</CardTitle>
            <CardDescription>Communiquer avec vos élèves et collègues</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/pro/messages" className="inline-block w-full">
              <Button className="w-full">Voir mes conversations</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Network size={18}/> Réseau Pro</CardTitle>
            <CardDescription>Découvrir et contacter d'autres professionnels</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/pro/network" className="inline-block w-full">
              <Button className="w-full" variant="secondary">Explorer le réseau</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Percent size={18}/> Mon Offre de Cours</CardTitle>
            <CardDescription>Créer votre offre pour attirer des élèves</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/pro/offers" className="inline-block w-full">
              <Button className="w-full">Gérer mon offre</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen size={18}/> Réservations</CardTitle>
            <CardDescription>Gérer tes créneaux, demandes et sessions confirmées.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs font-medium">
              <Badge variant="outline">
                {planningStats
                  ? `${planningStats.availabilityCount} créneau${planningStats.availabilityCount > 1 ? 'x' : ''}`
                  : '-- créneaux'}
              </Badge>
              <Badge variant={planningStats && planningStats.pendingCount > 0 ? 'secondary' : 'outline'}>
                {planningStats
                  ? `${planningStats.pendingCount} demande${planningStats.pendingCount > 1 ? 's' : ''} en attente`
                  : '-- demandes'}
              </Badge>
            </div>
            <Link href="/pro/planning" className="inline-block w-full">
              <Button className="w-full" variant="secondary">Ouvrir mon planning</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCard size={18}/> Paiements</CardTitle>
            <CardDescription>Gérer tes revenus et paiements</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline" disabled>En préparation</Button>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info size={18}/> À propos & RGPD</CardTitle>
            <CardDescription>
              Comprendre l'utilisation des données, la sécurité et le fonctionnement du site.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/about" className="inline-block w-full sm:w-auto">
              <Button>En savoir plus</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
