"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import Link from 'next/link';
import { User, Map, CreditCard, Percent, Info, LogOut, MessageSquare } from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number>(0);

  useEffect(() => {
    const t = apiClient.getTokens();
    if (!t?.accessToken) {
      router.replace('/login');
      return;
    }
    apiClient
      .me()
      .then((u) => {
        setUser(u);
        // First-login banner heuristic: show once per user until dismissed
        const key = `visited-dashboard-${u?.id}`;
        const visited = typeof window !== 'undefined' ? localStorage.getItem(key) : '1';
        if (!visited) setShowProfilePrompt(true);
        if (typeof window !== 'undefined') localStorage.setItem(key, '1');
      })
      .finally(() => setLoading(false));
  }, [router]);

  // Load aggregated unread count for conversations
  useEffect(() => {
    let active = true;
    const loadUnread = async () => {
      try {
        const data = await apiClient.listConversations();
        if (!active) return;
        const total = (data.items || []).reduce((acc: number, it: any) => acc + (Number(it.unread) || 0), 0);
        setUnreadTotal(total);
      } catch {}
    };
    loadUnread();
    const t = setInterval(loadUnread, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const role = user?.role as 'RIDER' | 'PRO' | 'ADMIN' | undefined;

  const logout = async () => {
    try {
      await apiClient.logoutAll();
    } catch (_) {}
    apiClient.clearTokens();
    router.replace('/login');
  };

  if (loading) return <p>Chargement…</p>;
  if (!user) return null;

  // Riders (particuliers): show full dashboard
  const isRider = role === 'RIDER' || !role;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Bienvenue, {user?.email}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/account" className="text-sm underline text-primary">Mon compte</Link>
          <Button variant="destructive" onClick={logout} className="inline-flex items-center gap-2"><LogOut size={16}/> Déconnexion</Button>
        </div>
      </div>

      {isRider ? (
        <>
          {showProfilePrompt && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Première connexion détectée. Pense à compléter ton profil pour un meilleur matching.
              <div className="mt-2 flex gap-2">
                <Link href="/profile" className="underline text-amber-900">Compléter mon profil</Link>
                <button onClick={() => setShowProfilePrompt(false)} className="underline">Plus tard</button>
              </div>
            </div>
          )}

          {!user?.emailVerified && (
            <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              Ton email n’est pas encore vérifié. Pense à confirmer ton adresse pour sécuriser ton compte.
              <div className="mt-2">
                <Link className="underline" href="/account">Voir mon compte</Link>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MessageSquare size={18}/> Messagerie {unreadTotal>0 && (<span className="ml-2 inline-flex items-center rounded-full bg-primary/10 text-primary text-xs px-2 py-0.5">{unreadTotal}</span>)}</CardTitle>
                <CardDescription>Retrouve tes conversations</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/messages" className="inline-block w-full">
                  <Button className="w-full" variant="outline">Ouvrir la messagerie</Button>
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><User size={18}/> Profil</CardTitle>
                <CardDescription>Crée ou mets à jour tes infos</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/profile" className="inline-block w-full">
                  <Button className="w-full">Compléter mon profil</Button>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Map size={18}/> Matching</CardTitle>
                <CardDescription>Trouve des partenaires proches</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/matching" className="inline-block w-full">
                  <Button className="w-full" variant="secondary">Accéder au matching</Button>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard size={18}/> Paiements</CardTitle>
                <CardDescription>Ajoute du crédit à ton compte</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/payments" className="inline-block w-full">
                  <Button className="w-full" variant="outline">Ajouter du crédit</Button>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Percent size={18}/> Offres</CardTitle>
                <CardDescription>Promotions et avantages</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/promos" className="inline-block w-full">
                  <Button className="w-full" variant="outline">Voir les offres</Button>
                </Link>
              </CardContent>
            </Card>

            <Card className="sm:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Info size={18}/> À propos & RGPD</CardTitle>
                <CardDescription>
                  Comprendre l’utilisation des données, la sécurité et le fonctionnement du site.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/about" className="inline-block w-full sm:w-auto">
                  <Button>En savoir plus</Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Espace Professionnel</CardTitle>
            <CardDescription>
              Interface dédiée en préparation (planning, réservations, paiements pro, offres…)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Reviens bientôt — ou contacte le support pour en savoir plus.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
